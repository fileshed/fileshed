//----------------------------------------------------------------------------------------------------------------------
// Migration 005 — quota aggregate index
//
// The quota charge runs on every upload admission, so the requirement is that it reads an index rather than every file
// row the owner has. The statements below are built here rather than borrowed from NodeRA, which makes these an
// assertion that the index serves the charge's predicate shape -- that the RA computes the charge correctly is
// node.spec.ts's job. They are explained in their parameterized form, the form production actually runs.
//
// Both planners are asked the same question in their own dialect. Postgres costs its choices against real statistics,
// so an empty table would plan a sequential scan no matter how good the index is; the rows seeded below give it a
// selective owner to plan for, and the vacuum sets the visibility map an index-only scan needs.
//----------------------------------------------------------------------------------------------------------------------

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { CompiledQuery, type Kysely, sql } from 'kysely';

// Resource Access
import type { Database, DatabaseHandle, DatabaseKind } from '@server/resource-access/database/database.ts';
import { down } from '@server/resource-access/database/migrations/005_quota_aggregate_index.ts';

// Support
import { createTestDatabase, seedBackend, seedBlob, seedUser } from '../../nodes/support.ts';

//----------------------------------------------------------------------------------------------------------------------

const INDEX_NAME = 'node_owner_size_idx';

const OWNER_COUNT = 60;
const FILES_PER_OWNER = 20;

// The plan for a statement, run with the statement's real parameters bound. Each dialect names its output column
// differently (`detail` on SQLite, `QUERY PLAN` on Postgres), so the row's values are taken as they come.
async function planFor(db : Kysely<Database>, kind : DatabaseKind, compiled : CompiledQuery) : Promise<string>
{
    const explain = kind === 'postgres' ? 'explain' : 'explain query plan';
    const explained = await db.executeQuery(
        CompiledQuery.raw(`${ explain } ${ compiled.sql }`, [ ...compiled.parameters ])
    );

    return explained.rows.map((row) => Object.values(row as Record<string, unknown>).join(' ')).join('\n');
}

// The per-owner charge: the total size of the file nodes an owner holds.
function ownedBytesQuery(db : Kysely<Database>, ownerID : string) : CompiledQuery
{
    return db
        .selectFrom('node')
        .select(sql<number>`coalesce(sum(size), 0)`.as('total'))
        .where('owner_id', '=', ownerID)
        .where('type', '=', 'file')
        .compile();
}

// The same charge for a batch of owners, as the admin usage column asks for it.
function ownedBytesByOwnerQuery(db : Kysely<Database>, ownerIDs : string[]) : CompiledQuery
{
    return db
        .selectFrom('node')
        .select([ 'owner_id', sql<number>`coalesce(sum(size), 0)`.as('total') ])
        .where('owner_id', 'in', ownerIDs)
        .where('type', '=', 'file')
        .groupBy('owner_id')
        .compile();
}

//----------------------------------------------------------------------------------------------------------------------

// Enough owners that any one of them is a small slice of the table -- a charge that covered most of the rows would be
// cheapest to read straight from the table, and would prove nothing about the index.
async function seedChargeableRows(db : Kysely<Database>) : Promise<void>
{
    const owners = [ 'alice', 'bob', ...Array.from({ length: OWNER_COUNT - 2 }, (_, index) => `owner-${ index }`) ];
    const stamp = new Date().toISOString();

    await seedBackend(db, 'backend-1');
    await seedBlob(db, 'a'.repeat(64), 'backend-1');

    await Promise.all(owners.map((owner) => seedUser(db, owner)));

    /* eslint-disable camelcase -- snake_case DB columns (house convention for Kysely inserts) */
    await db
        .insertInto('node')
        .values(owners.flatMap((owner) => Array.from({ length: FILES_PER_OWNER }, (_, index) => ({
            id: `${ owner }-file-${ index }`,
            type: 'file' as const,
            name: `file-${ index }.bin`,
            owner_id: owner,
            parent_id: null,
            blob_id: 'a'.repeat(64),
            target_node_id: null,
            size: 10,
            mime_type: 'application/octet-stream',
            created_at: stamp,
            updated_at: stamp,
            trashed_at: null,
        }))))
        .execute();
    /* eslint-enable camelcase */
}

// Postgres plans against statistics it has actually gathered, and an index-only scan additionally needs the
// visibility map that vacuum builds. SQLite's planner needs neither.
async function primePlanner(db : Kysely<Database>, kind : DatabaseKind) : Promise<void>
{
    if(kind === 'postgres') { await sql`vacuum analyze node`.execute(db); }
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

//----------------------------------------------------------------------------------------------------------------------

let handle : DatabaseHandle;
let db : Kysely<Database>;
let kind : DatabaseKind;

beforeEach(async () =>
{
    handle = await createTestDatabase();
    db = handle.db;
    kind = handle.kind;

    await seedChargeableRows(db);
    await primePlanner(db, kind);
});

afterEach(async () =>
{
    await db.destroy();
});

//----------------------------------------------------------------------------------------------------------------------

describe('migration 005 — quota aggregate index', () =>
{
    it('serves the per-owner quota charge from an index instead of reading the node table', async () =>
    {
        const plan = await planFor(db, kind, ownedBytesQuery(db, 'alice'));

        expect(plan).toContain(INDEX_NAME);
        expect(plan).not.toMatch(kind === 'postgres' ? /Seq Scan on node/ : /SCAN node(?! USING)/);
    });

    it('covers the charge, so summing sizes never sends the aggregate back to the table', async () =>
    {
        const plan = await planFor(db, kind, ownedBytesQuery(db, 'alice'));

        expect(plan).toContain(kind === 'postgres' ? 'Index Only Scan' : 'COVERING INDEX');
    });

    it('serves the batched per-owner charge from the same index', async () =>
    {
        const plan = await planFor(db, kind, ownedBytesByOwnerQuery(db, [ 'alice', 'bob' ]));

        expect(plan).toContain(INDEX_NAME);
    });

    it('takes only the index back out when rolled back, leaving the node table standing', async () =>
    {
        await down(db);

        expect(await catalogNames(db, kind, 'index')).not.toContain(INDEX_NAME);
        expect(await catalogNames(db, kind, 'table')).toContain('node');
    });
});

//----------------------------------------------------------------------------------------------------------------------
