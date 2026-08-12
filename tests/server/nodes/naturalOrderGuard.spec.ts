//----------------------------------------------------------------------------------------------------------------------
// Natural name ordering — the SQLite in-memory guard
//
// SQLite orders names in Node, which means holding the whole folder's names at once, so there is a size past which it
// stops and hands the ordering back to SQL. This seeds a folder either side of that line. Postgres has no such line --
// its collation orders inside the index -- so the guard is a SQLite-only contract and the suite skips it elsewhere.
//----------------------------------------------------------------------------------------------------------------------

/* eslint-disable camelcase -- the seed builds snake_case DB rows (house convention for Kysely inserts) */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { LISTING_CHUNK_SIZE, type NodeListResponse, SQLITE_MAX_SORTED_IN_MEMORY } from '@fileshed/core';

// Support
import { testDatabaseKind } from '../support/database.ts';
import { type BootedServeApp, ORIGIN, type TestUser, bootServeApp, makeUser } from '../publicLinks/support.ts';

//----------------------------------------------------------------------------------------------------------------------

// The two names the ordering is read from: natural order puts track-9 first, lexical order puts track-10 first.
const PROBES = [ 'track-10.mp3', 'track-9.mp3' ];

// Filler sorts after both probes under either ordering, so the probes stay on the first page whichever one is running.
const FILLER_PREFIX = 'zz-filler';

const SHA256 = 'd'.repeat(64);
const INSERT_BATCH = 5000;

let booted : BootedServeApp;
let owner : TestUser;

//----------------------------------------------------------------------------------------------------------------------

async function seedFolder(total : number) : Promise<void>
{
    const now = new Date().toISOString();
    const backend = await booted.handle.db
        .selectFrom('storage_backend')
        .select('id')
        .executeTakeFirstOrThrow();

    await booted.handle.db
        .insertInto('blob')
        .values({
            sha256: SHA256,
            size: 10,
            backend_id: backend.id,
            storage_key: 'seed/guard',
            created_at: now,
            deleted_at: null,
        } as never)
        .execute();

    const names = [
        ...PROBES,
        ...Array.from({ length: total - PROBES.length }, (_unused, index) =>
        {
            return `${ FILLER_PREFIX }-${ String(index).padStart(7, '0') }.txt`;
        }),
    ];

    const rows = names.map((name, index) => ({
        id: `g-${ String(index).padStart(7, '0') }`,
        name,
        type: 'file' as const,
        owner_id: owner.id,
        parent_id: null,
        blob_id: SHA256,
        size: 10,
        mime_type: 'application/octet-stream',
        created_at: now,
        updated_at: now,
        trashed_at: null,
        target_node_id: null,
    }));

    for(let at = 0; at < rows.length; at += INSERT_BATCH)
    {
        // eslint-disable-next-line no-await-in-loop -- one batch at a time: SQLite caps bound parameters per statement
        await booted.handle.db
            .insertInto('node')
            .values(rows.slice(at, at + INSERT_BATCH) as never)
            .execute();
    }
}

async function probeOrder() : Promise<string[]>
{
    const res = await booted.app.request(
        `${ ORIGIN }/api/nodes/children?limit=${ LISTING_CHUNK_SIZE }&sortKey=name&sortDirection=asc`,
        { headers: { cookie: owner.cookie } }
    );
    const body = await res.json() as NodeListResponse;

    return body.nodes.map((node) => node.name).filter((name) => PROBES.includes(name));
}

//----------------------------------------------------------------------------------------------------------------------

beforeEach(async () =>
{
    booted = await bootServeApp();
    owner = await makeUser(booted, 'owner@example.com');
});

afterEach(async () =>
{
    await booted.cleanup();
});

//----------------------------------------------------------------------------------------------------------------------

describe.runIf(testDatabaseKind() === 'sqlite')('SQLite in-memory sort guard', () =>
{
    it('orders names naturally in a folder that reaches the guard exactly', async () =>
    {
        await seedFolder(SQLITE_MAX_SORTED_IN_MEMORY);

        expect(await probeOrder()).toEqual([ 'track-9.mp3', 'track-10.mp3' ]);
    }, 120_000);

    it('falls back to the lexical ordering one node past the guard', async () =>
    {
        await seedFolder(SQLITE_MAX_SORTED_IN_MEMORY + 1);

        expect(await probeOrder()).toEqual([ 'track-10.mp3', 'track-9.mp3' ]);
    }, 120_000);
});

//----------------------------------------------------------------------------------------------------------------------
