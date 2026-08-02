//----------------------------------------------------------------------------------------------------------------------
// Database Factory — SQLite connection
//
// Every pragma assertion reads back through a real file-backed handle: SQLite silently ignores a pragma it does not
// recognise, so a misspelling leaves no error behind, and a :memory: database cannot be put into WAL at all.
//
// node:sqlite applies none of these on its own, so what the factory sets is the whole of the deployment's connection
// configuration.
//----------------------------------------------------------------------------------------------------------------------

import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { sql } from 'kysely';

// Models
import { SQLITE_BUSY_TIMEOUT_MS, SQLITE_CACHE_SIZE } from '@fileshed/core';

// Resource Access
import { type DatabaseHandle, createDatabase } from '@server/resource-access/database/database.ts';

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
});

//----------------------------------------------------------------------------------------------------------------------
