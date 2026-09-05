//----------------------------------------------------------------------------------------------------------------------
// Migration 008 — natural name collation
//
// The requirement is that a folder listing ordered by name reads its page from an index rather than sweeping the
// folder and sorting it. The statement below is built here rather than borrowed from NodeRA, which makes this an
// assertion that the index serves the listing's shape -- that the RA orders correctly is naturalOrder.spec.ts's job.
//
// Postgres costs its choices against real statistics, so the rows seeded below make one page a small enough slice of
// the folder that reading it in order is the cheaper answer. SQLite gets nothing from this migration and is asserted
// to get nothing: it orders names in Node instead.
//----------------------------------------------------------------------------------------------------------------------

/* eslint-disable camelcase -- the seed builds snake_case DB rows (house convention for Kysely inserts) */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { CompiledQuery, type Kysely, sql } from 'kysely';

// Models
import { NATURAL_ORDER_COLLATION, SEARCH_CANDIDATE_LIMIT } from '@fileshed/core';

// Resource Access
import type { Database, DatabaseHandle, DatabaseKind } from '@server/resource-access/database/database.ts';
import {
    assertICUAvailable,
    down,
    icuCollationCount,
} from '@server/resource-access/database/migrations/008_natural_name_collation.ts';

// Support
import { testDatabaseKind } from '../../../support/database.ts';
import { createTestDatabase, seedBackend, seedBlob, seedUser } from '../../nodes/support.ts';

//----------------------------------------------------------------------------------------------------------------------

const INDEX_NAME = 'node_natural_name_idx';
const PARENT_ID = 'folder-1';

// Enough rows that one page is a small slice of the folder -- a page covering most of it would be cheapest to read
// straight from the table and sort, and would prove nothing about the index.
const ROW_COUNT = SEARCH_CANDIDATE_LIMIT * 5;

const INSERT_BATCH = 1000;

//----------------------------------------------------------------------------------------------------------------------

async function planFor(db : Kysely<Database>, kind : DatabaseKind, compiled : CompiledQuery) : Promise<string>
{
    const explain = kind === 'postgres' ? 'explain' : 'explain query plan';
    const explained = await db.executeQuery(
        CompiledQuery.raw(`${ explain } ${ compiled.sql }`, [ ...compiled.parameters ])
    );

    return explained.rows.map((row) => Object.values(row as Record<string, unknown>).join(' ')).join('\n');
}

// The folder listing: a page of live children, folders pinned above the rest, names in the natural collation, id last.
function nameOrderedListingQuery(db : Kysely<Database>) : CompiledQuery
{
    return db
        .selectFrom('node')
        .selectAll()
        .where('trashed_at', 'is', null)
        .where('parent_id', '=', PARENT_ID)
        .orderBy(sql`case when ${ sql.ref('type') } = 'folder' then 0 else 1 end`, 'asc')
        .orderBy(sql`${ sql.ref('name') } collate ${ sql.ref(NATURAL_ORDER_COLLATION) }`, 'asc')
        .orderBy('id', 'asc')
        .limit(1000)
        .compile();
}

//----------------------------------------------------------------------------------------------------------------------

async function seedFolder(db : Kysely<Database>) : Promise<void>
{
    const stamp = new Date().toISOString();

    await seedUser(db, 'alice');
    await seedBackend(db, 'backend-1');
    await seedBlob(db, 'a'.repeat(64), 'backend-1');

    await db
        .insertInto('node')
        .values({
            id: PARENT_ID,
            type: 'folder',
            name: 'folder',
            owner_id: 'alice',
            parent_id: null,
            blob_id: null,
            target_node_id: null,
            size: null,
            mime_type: null,
            created_at: stamp,
            updated_at: stamp,
            trashed_at: null,
        } as never)
        .execute();

    // Case alternates and the numbers are unpadded, so the natural order and the stored order genuinely differ.
    const rows = Array.from({ length: ROW_COUNT }, (_unused, index) => ({
        id: `node-${ index }`,
        type: 'file' as const,
        name: `${ index % 2 === 0 ? 'Track' : 'track' }-${ index }.mp3`,
        owner_id: 'alice',
        parent_id: PARENT_ID,
        blob_id: 'a'.repeat(64),
        target_node_id: null,
        size: 10,
        mime_type: 'audio/mpeg',
        created_at: stamp,
        updated_at: stamp,
        trashed_at: null,
    }));

    for(let start = 0; start < rows.length; start += INSERT_BATCH)
    {
        // eslint-disable-next-line no-await-in-loop -- Postgres caps bound parameters per statement
        await db
            .insertInto('node')
            .values(rows.slice(start, start + INSERT_BATCH) as never)
            .execute();
    }
}

async function catalogNames(db : Kysely<Database>, kind : DatabaseKind, type : 'index' | 'table') : Promise<string[]>
{
    const query = kind === 'postgres'
        ? sql<{ name : string }>`
            select ${ sql.ref(type === 'index' ? 'indexname' : 'tablename') } as name
            from ${ sql.table(type === 'index' ? 'pg_indexes' : 'pg_tables') }
            where schemaname = current_schema()
        `
        : sql<{ name : string }>`select name from sqlite_master where type = ${ type }`;

    const result = await query.execute(db);

    return result.rows.map((row) => row.name);
}

async function collationNames(db : Kysely<Database>) : Promise<string[]>
{
    const result = await sql<{ collname : string }>`
        select collname from pg_collation where collname = ${ NATURAL_ORDER_COLLATION }
    `.execute(db);

    return result.rows.map((row) => row.collname);
}

//----------------------------------------------------------------------------------------------------------------------

let handle : DatabaseHandle;
let db : Kysely<Database>;
let kind : DatabaseKind;

beforeEach(async () =>
{
    handle = await createTestDatabase();
    db = handle.db;
    kind = handle.kind;
});

afterEach(async () =>
{
    await db.destroy();
});

//----------------------------------------------------------------------------------------------------------------------

describe.runIf(testDatabaseKind() === 'postgres')('migration 008 — natural name collation on Postgres', () =>
{
    // One seeded folder answers both halves of the requirement -- that the page comes off the index, and that it
    // arrives already ordered -- and seeding it once keeps this spec off the shared server's back.
    it('reads the name-ordered page from the index, already in order', async () =>
    {
        await seedFolder(db);
        await sql`vacuum analyze node`.execute(db);

        const plan = await planFor(db, kind, nameOrderedListingQuery(db));

        expect(plan).toContain(INDEX_NAME);
        expect(plan).not.toMatch(/Seq Scan on node/);
        expect(plan).not.toMatch(/Sort/);
    }, 60_000);

    // The probe's own query, against a real server: the catalog column and the provider letter are the parts that
    // could be quietly wrong and would then wave every deployment through.
    it('finds the ICU collations the server actually has', async () =>
    {
        expect(await icuCollationCount(db as unknown as Kysely<unknown>)).toBeGreaterThan(0);
    });

    it('takes the index and the collation back out when rolled back, leaving the node table standing', async () =>
    {
        await down(db as unknown as Kysely<unknown>, kind);

        expect(await catalogNames(db, kind, 'index')).not.toContain(INDEX_NAME);
        expect(await collationNames(db)).toEqual([]);
        expect(await catalogNames(db, kind, 'table')).toContain('node');
    });
});

//----------------------------------------------------------------------------------------------------------------------

// A Postgres compiled without ICU cannot have this collation at all. The migration finds that out before it writes
// anything, and stops -- ordering listings lexically on one deployment while every other tier orders them naturally
// is precisely the divergence the collation exists to remove, and nothing would retry a migration that only warned.
describe('migration 008 — ICU availability', () =>
{
    it('stops the migration when the server carries no ICU collations', () =>
    {
        expect(() => assertICUAvailable(0)).toThrow(/ICU/);
    });

    it('tells the operator what the deployment needs and what its alternative is', () =>
    {
        expect(() => assertICUAvailable(0)).toThrow(/Postgres/);
        expect(() => assertICUAvailable(0)).toThrow(/SQLite/);
        expect(() => assertICUAvailable(0)).toThrow(/changed nothing/);
    });

    it('lets the migration run when the server carries them', () =>
    {
        expect(() => assertICUAvailable(1)).not.toThrow();
    });
});

//----------------------------------------------------------------------------------------------------------------------

describe.runIf(testDatabaseKind() === 'sqlite')('migration 008 — natural name collation on SQLite', () =>
{
    // The dialect has no ICU to collate with, and nothing to index that would order naturally, so the migration is
    // deliberately empty here. The ordering it stands for happens in Node instead.
    it('creates no index, because SQLite orders names outside the database', async () =>
    {
        expect(await catalogNames(db, kind, 'index')).not.toContain(INDEX_NAME);
    });
});

//----------------------------------------------------------------------------------------------------------------------
