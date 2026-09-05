//----------------------------------------------------------------------------------------------------------------------
// Natural name ordering — the SQLite in-memory guard
//
// SQLite orders names in Node, which means holding the whole folder's names at once, so there is a size past which it
// stops and hands the ordering back to SQL. This seeds a folder either side of that line. Postgres has no such line --
// its collation orders inside the index -- so the guard is a SQLite-only contract and the suite skips it elsewhere.
//----------------------------------------------------------------------------------------------------------------------

/* eslint-disable camelcase -- the seed builds snake_case DB rows (house convention for Kysely inserts) */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
    LISTING_CHUNK_SIZE,
    type NodeListResponse,
    SQLITE_MAX_SORTED_IN_MEMORY,
    SQLITE_MAX_SORTED_NAME_CHARS,
} from '@fileshed/core';

// Support
import { testDatabaseKind } from '../support/database.ts';
import { type BootedServeApp, ORIGIN, type TestUser, bootServeApp, makeUser } from '../publicLinks/support.ts';

//----------------------------------------------------------------------------------------------------------------------

// The two names the ordering is read from: natural order puts track-9 first, lexical order puts track-10 first.
const PROBES = [ 'track-10.mp3', 'track-9.mp3' ];

// Filler sorts after both probes under either ordering, so the probes stay on the first page whichever one is running.
const FILLER_PREFIX = 'zz-filler';

const SHA256 = 'd'.repeat(64);
// Rows per insert. SQLite caps bound parameters per statement -- 32,766 since 3.32, and a node row binds twelve
// columns -- so this stays far enough under that a build with a lower cap than the one it was written on still
// seeds. 5,000 rows was 60,000 parameters and only worked by the grace of whichever SQLite the runtime shipped.
const INSERT_BATCH = 1000;

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

// Rows carrying names far longer than anything the API would accept today -- what an instance that was attacked
// before the name cap landed still has on disk. They sort after the probes under either ordering.
async function seedOverlongNames(count : number, length : number) : Promise<void>
{
    const now = new Date().toISOString();

    // Files, like the probes: a folder would outrank them and take the page the probes are read from.
    const rows = Array.from({ length: count }, (_unused, index) => ({
        id: `overlong-${ String(index).padStart(4, '0') }`,
        name: `zz-overlong-${ String(index).padStart(4, '0') }-${ 'x'.repeat(length) }`,
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

    for(const row of rows)
    {
        // eslint-disable-next-line no-await-in-loop -- a name this long is megabytes; batching them multiplies that
        await booted.handle.db
            .insertInto('node')
            .values(row as never)
            .execute();
    }
}

async function probeOrder(limit : number = LISTING_CHUNK_SIZE) : Promise<string[]>
{
    const res = await booted.app.request(
        `${ ORIGIN }/api/nodes/children?limit=${ limit }&sortKey=name&sortDirection=asc`,
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
// The same guard, counted in characters rather than rows
//----------------------------------------------------------------------------------------------------------------------

// Long enough that a handful of rows reach the character budget, so the guard is exercised at its real constant.
const OVERLONG_NAME_CHARS = 250_000;

describe.runIf(testDatabaseKind() === 'sqlite')('SQLite in-memory sort guard — name characters', () =>
{
    // A row count nowhere near the guard can still be far too much to hold, because nothing bounded a stored name
    // before the API capped one. The listing must answer either way -- an owner whose folder was filled with these
    // has to be able to list it to clean it up -- so it hands the ordering back to SQL rather than reading them all.
    it('falls back to the lexical ordering when the names outweigh the budget, whatever the row count', async () =>
    {
        const overBudget = Math.ceil(SQLITE_MAX_SORTED_NAME_CHARS / OVERLONG_NAME_CHARS) + 1;

        await seedFolder(PROBES.length);
        await seedOverlongNames(overBudget, OVERLONG_NAME_CHARS);

        expect(await probeOrder(2)).toEqual([ 'track-10.mp3', 'track-9.mp3' ]);
    }, 120_000);

    // The budget is the selection's total, not a verdict on any one name: a few long names still sort in Node.
    it('orders names naturally when long names do not add up to the budget', async () =>
    {
        await seedFolder(PROBES.length);
        await seedOverlongNames(4, OVERLONG_NAME_CHARS);

        expect(await probeOrder(2)).toEqual([ 'track-9.mp3', 'track-10.mp3' ]);
    }, 120_000);
});

//----------------------------------------------------------------------------------------------------------------------
