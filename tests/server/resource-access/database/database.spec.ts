//----------------------------------------------------------------------------------------------------------------------
// Database Factory — SQLite connection
//
// Every pragma assertion reads back through a real file-backed handle: SQLite silently ignores a pragma it does not
// recognise, so a misspelling leaves no error behind, and a :memory: database cannot be put into WAL at all.
//
// The busy-timeout and page-cache values are ones better-sqlite3 already opens with. Asserting them guards the
// deployment's effective configuration against a driver that changes its mind, not the pragma lines themselves.
//----------------------------------------------------------------------------------------------------------------------

import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { sql } from 'kysely';
import BetterSqlite3 from 'better-sqlite3';

// Models
import { SQLITE_BUSY_TIMEOUT_MS, SQLITE_CACHE_SIZE, SQLITE_STATEMENT_CACHE_SIZE } from '@fileshed/core';

// Resource Access
import {
    type DatabaseHandle,
    type StatementCacheTarget,
    createDatabase,
    withStatementCache,
} from '@server/resource-access/database/database.ts';

// Utils
import type { Config } from '@server/utils/config.ts';

//----------------------------------------------------------------------------------------------------------------------

// SQLite reports each pragma under its own key, and not always the one it was set by (busy_timeout reads as `timeout`).
async function pragma(handle : DatabaseHandle, name : string) : Promise<number | string>
{
    const result = await sql.raw(`pragma ${ name }`).execute(handle.db);
    const row = result.rows[0] as Record<string, number | string>;

    return Object.values(row)[0];
}

//----------------------------------------------------------------------------------------------------------------------

let directory : string;
let databasePath : string;
let handle : DatabaseHandle;

beforeEach(async () =>
{
    directory = await mkdtemp(join(tmpdir(), 'fileshed-db-spec-'));
    databasePath = join(directory, 'fileshed.db');

    const config : Config = {
        HOST: '127.0.0.1',
        PORT: 3000,
        DATABASE_KIND: 'sqlite',
        DATABASE_PATH: databasePath,
        AUTH_SECRET: 'test-auth-secret-at-least-32-chars-long',
        BASE_URL: 'http://localhost:5173',
        STORAGE_ROOT: './data/blobs',
        GC_GRACE_DAYS: 7,
        GC_INTERVAL_MINUTES: 60,
        TRASH_PURGE_DAYS: 30,
        UPLOAD_MAX_BYTES: 5 * 1024 * 1024 * 1024,
    };

    handle = createDatabase(config);
});

afterEach(async () =>
{
    await handle.db.destroy();
    await rm(directory, { recursive: true, force: true });
});

//----------------------------------------------------------------------------------------------------------------------

describe('createDatabase — SQLite connection', () =>
{
    it('opens a file-backed database in WAL mode, so a read is not blocked by a concurrent write', async () =>
    {
        expect(await pragma(handle, 'journal_mode')).toBe('wal');
    });

    it('lands committed writes in a WAL sidecar beside the database file', async () =>
    {
        await sql.raw('create table probe (id text primary key)').execute(handle.db);
        await sql.raw(`insert into probe (id) values ('a')`).execute(handle.db);

        // The half of the database a backup taken from the .db file alone would miss.
        expect(existsSync(`${ databasePath }-wal`)).toBe(true);
    });

    it('opens with a busy timeout, so a competing writer is waited out rather than thrown at the caller', async () =>
    {
        expect(await pragma(handle, 'busy_timeout')).toBe(SQLITE_BUSY_TIMEOUT_MS);
    });

    it('opens with the page cache the deployment expects', async () =>
    {
        expect(await pragma(handle, 'cache_size')).toBe(SQLITE_CACHE_SIZE);
    });

    it('syncs at checkpoints rather than on every commit', async () =>
    {
        // PRAGMA synchronous reports the level as an ordinal; NORMAL is 1.
        expect(await pragma(handle, 'synchronous')).toBe(1);
    });

    it('sees a column added after the same statement was already compiled once', async () =>
    {
        await sql.raw('create table probe (original text)').execute(handle.db);
        await sql.raw(`insert into probe (original) values ('kept')`).execute(handle.db);

        // Identical SQL either side of the ALTER, so the second run is served from the cache.
        const before = await sql.raw('select * from probe').execute(handle.db);
        await sql.raw(`alter table probe add column added text default 'filled'`).execute(handle.db);
        const after = await sql.raw('select * from probe').execute(handle.db);

        expect(before.rows).toEqual([ { original: 'kept' } ]);
        expect(after.rows).toEqual([ { original: 'kept', added: 'filled' } ]);
    });
});

//----------------------------------------------------------------------------------------------------------------------

// A real driver handle that counts how many times it was asked to compile something. Counting through the seam keeps
// the assertions off better-sqlite3's internals.
function countingTarget() : StatementCacheTarget & { compiles : number; done() : void }
{
    const sqlite = new BetterSqlite3(':memory:');

    return {
        compiles: 0,
        close: () => sqlite.close(),
        done: () => sqlite.close(),
        prepare(source : string)
        {
            this.compiles += 1;

            return sqlite.prepare(source);
        },
    };
}

//----------------------------------------------------------------------------------------------------------------------

describe('withStatementCache', () =>
{
    it('compiles a repeated statement once and a new one again', () =>
    {
        const target = countingTarget();
        const cached = withStatementCache(target);

        cached.prepare('select 1');
        cached.prepare('select 1');
        cached.prepare('select 2');

        expect(target.compiles).toBe(2);

        target.done();
    });

    it('hands back the very same compiled statement on a hit', () =>
    {
        const target = countingTarget();
        const cached = withStatementCache(target);

        expect(cached.prepare('select 1')).toBe(cached.prepare('select 1'));

        target.done();
    });

    it('stops growing at its cap, recompiling whatever fell out of it', () =>
    {
        const target = countingTarget();
        const cached = withStatementCache(target);

        // One more distinct statement than the cache holds, so the coldest -- the first -- is evicted.
        for(let index = 0; index <= SQLITE_STATEMENT_CACHE_SIZE; index++)
        {
            cached.prepare(`select ${ index }`);
        }

        const compilesBeforeRevisit = target.compiles;
        cached.prepare('select 0');

        expect(compilesBeforeRevisit).toBe(SQLITE_STATEMENT_CACHE_SIZE + 1);
        expect(target.compiles).toBe(SQLITE_STATEMENT_CACHE_SIZE + 2);

        target.done();
    });

    it('compiles a fresh statement rather than handing out one that is mid-iteration', () =>
    {
        const target = countingTarget();
        const cached = withStatementCache(target);

        cached.prepare('create table t (a integer)').run();
        cached.prepare('insert into t (a) values (1), (2)').run();

        const reader = cached.prepare('select a from t');
        const walk = reader.iterate();
        walk.next();

        expect(cached.prepare('select a from t')).not.toBe(reader);

        walk.return?.(undefined);
        target.done();
    });
});

//----------------------------------------------------------------------------------------------------------------------
