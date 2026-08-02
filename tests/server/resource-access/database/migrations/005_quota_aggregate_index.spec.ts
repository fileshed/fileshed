//----------------------------------------------------------------------------------------------------------------------
// Migration 005 — quota aggregate index
//
// The quota charge runs on every upload admission, so the requirement is that it reads an index rather than every file
// row the owner has. The statements below are built here rather than borrowed from NodeRA, which makes these an
// assertion that the index serves the charge's predicate shape -- that the RA computes the charge correctly is
// node.spec.ts's job. They are explained in their parameterized form, the form production actually runs.
//----------------------------------------------------------------------------------------------------------------------

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { CompiledQuery, type Kysely, sql } from 'kysely';

// Resource Access
import type { Database, DatabaseHandle } from '@server/resource-access/database/database.ts';
import { down } from '@server/resource-access/database/migrations/005_quota_aggregate_index.ts';

// Support
import { createTestDatabase } from '../../nodes/support.ts';

//----------------------------------------------------------------------------------------------------------------------

const INDEX_NAME = 'node_owner_size_idx';

// SQLite's own plan for a statement, run with the statement's real parameters bound.
async function planFor(db : Kysely<Database>, compiled : CompiledQuery) : Promise<string>
{
    const explained = await db.executeQuery(
        CompiledQuery.raw(`explain query plan ${ compiled.sql }`, [ ...compiled.parameters ])
    );

    return explained.rows.map((row) => (row as { detail : string }).detail).join('\n');
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

let handle : DatabaseHandle;
let db : Kysely<Database>;

beforeEach(async () =>
{
    handle = await createTestDatabase();
    db = handle.db;
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
        const plan = await planFor(db, ownedBytesQuery(db, 'alice'));

        expect(plan).toContain(INDEX_NAME);
        expect(plan).not.toMatch(/SCAN node(?! USING)/);
    });

    it('covers the charge, so summing sizes never sends the aggregate back to the table', async () =>
    {
        const plan = await planFor(db, ownedBytesQuery(db, 'alice'));

        expect(plan).toContain('COVERING INDEX');
    });

    it('serves the batched per-owner charge from the same index', async () =>
    {
        const plan = await planFor(db, ownedBytesByOwnerQuery(db, [ 'alice', 'bob' ]));

        expect(plan).toContain(INDEX_NAME);
    });

    it('takes only the index back out when rolled back, leaving the node table standing', async () =>
    {
        await down(db);

        const indexes = await sql<{ name : string }>`select name from sqlite_master where type = 'index'`.execute(db);
        const tables = await sql<{ name : string }>`select name from sqlite_master where type = 'table'`.execute(db);

        expect(indexes.rows.map((row) => row.name)).not.toContain(INDEX_NAME);
        expect(tables.rows.map((row) => row.name)).toContain('node');
    });
});

//----------------------------------------------------------------------------------------------------------------------
