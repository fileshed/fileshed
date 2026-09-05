//----------------------------------------------------------------------------------------------------------------------
// Migration 006 — name ordering index
//
// Names order by their folded form, which is an expression rather than a stored column, so the requirement is that a
// name-ordered listing still reads an index instead of sweeping the table and sorting every match. The statement below
// is built here rather than borrowed from NodeRA, which makes this an assertion that the index serves the listing's
// shape -- that the RA orders correctly is node.spec.ts's job. It is explained in its parameterized form, the form
// production actually runs.
//
// Both planners are asked the same question in their own dialect. Postgres costs its choices against real statistics,
// so a small table would sweep it no matter how good the index is; the rows seeded below make the page a small enough
// slice of the table that reading it in order is the cheaper answer.
//----------------------------------------------------------------------------------------------------------------------

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { CompiledQuery, type Expression, type Kysely, type SqlBool, sql } from 'kysely';

// Models
import { SEARCH_CANDIDATE_LIMIT } from '@fileshed/core';

// Resource Access
import type { Database, DatabaseHandle, DatabaseKind } from '@server/resource-access/database/database.ts';
import { down } from '@server/resource-access/database/migrations/006_name_ordering_index.ts';

// Support
import { createTestDatabase, seedBackend, seedBlob, seedUser } from '../../nodes/support.ts';

//----------------------------------------------------------------------------------------------------------------------

const INDEX_NAME = 'node_lower_name_idx';

// Enough rows that one page is a small slice of the table -- a page covering most of the rows would be cheapest to
// read straight from the table and sort, and would prove nothing about the index.
const ROW_COUNT = SEARCH_CANDIDATE_LIMIT * 20;

const INSERT_BATCH = 2000;

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

// The name search: a page of live nodes whose name or embedded tags match, in folded-name order with the id tiebreak.
function nameOrderedSearchQuery(db : Kysely<Database>, kind : DatabaseKind, term : string) : CompiledQuery
{
    const pattern = `%${ term }%`;
    const matches = (column : string) : Expression<SqlBool> =>
    {
        const ref = sql.ref(column);
        return kind === 'postgres'
            ? sql<SqlBool>`${ ref } ilike ${ pattern } escape '\\'`
            : sql<SqlBool>`${ ref } like ${ pattern } escape '\\'`;
    };

    return db
        .selectFrom('node')
        .leftJoin('media_tags', 'media_tags.blob_id', 'node.blob_id')
        .selectAll('node')
        .where('node.trashed_at', 'is', null)
        .where((eb) => eb.or([
            matches('node.name'),
            matches('media_tags.title'),
            matches('media_tags.artist'),
            matches('media_tags.album'),
        ]))
        .orderBy(sql<string>`lower(${ sql.ref('node.name') })`, 'asc')
        .orderBy('node.id', 'asc')
        .limit(SEARCH_CANDIDATE_LIMIT)
        .compile();
}

//----------------------------------------------------------------------------------------------------------------------

// Names alternate case so the folded order and the stored order genuinely differ, which is the ordering the index has
// to carry.
async function seedNamedRows(db : Kysely<Database>) : Promise<void>
{
    const stamp = new Date().toISOString();
    const alphabet = 'abcdefghijklmnopqrstuvwxyz';

    await seedUser(db, 'alice');
    await seedBackend(db, 'backend-1');
    await seedBlob(db, 'a'.repeat(64), 'backend-1');

    /* eslint-disable camelcase -- snake_case DB columns (house convention for Kysely inserts) */
    const rows = Array.from({ length: ROW_COUNT }, (_, index) =>
    {
        const letter = alphabet[index % alphabet.length] ?? 'a';
        const name = index % 2 === 0 ? letter.toUpperCase() : letter;

        return {
            id: `node-${ index }`,
            type: 'file' as const,
            name: `${ name }-report-${ index }.txt`,
            owner_id: 'alice',
            parent_id: null,
            blob_id: 'a'.repeat(64),
            target_node_id: null,
            size: 10,
            mime_type: 'text/plain',
            created_at: stamp,
            updated_at: stamp,
            trashed_at: null,
        };
    });
    /* eslint-enable camelcase */

    // Postgres caps a statement at 65535 bind parameters, which twelve columns reach well before this many rows.
    const batches : (typeof rows)[] = [];
    for(let start = 0; start < rows.length; start += INSERT_BATCH)
    {
        batches.push(rows.slice(start, start + INSERT_BATCH));
    }

    await Promise.all(batches.map((values) => db.insertInto('node').values(values)
        .execute()));
}

// Postgres plans against statistics it has actually gathered. SQLite's planner needs none.
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

    await seedNamedRows(db);
    await primePlanner(db, kind);
});

afterEach(async () =>
{
    await db.destroy();
});

//----------------------------------------------------------------------------------------------------------------------

describe('migration 006 — name ordering index', () =>
{
    it('serves the name-ordered listing from an index instead of reading the node table', async () =>
    {
        const plan = await planFor(db, kind, nameOrderedSearchQuery(db, kind, 'report'));

        expect(plan).toContain(INDEX_NAME);
        expect(plan).not.toMatch(kind === 'postgres' ? /Seq Scan on node/ : /SCAN node(?! USING)/);
    });

    // The index stores the folded name and the id tiebreak in the order the listing asks for them, so the page comes
    // back already ordered rather than gathered and sorted.
    it('carries the ordering itself, so the listing never sorts its matches', async () =>
    {
        const plan = await planFor(db, kind, nameOrderedSearchQuery(db, kind, 'report'));

        expect(plan).not.toMatch(kind === 'postgres' ? /Sort/ : /TEMP B-TREE/);
    });

    it('takes only the index back out when rolled back, leaving the node table standing', async () =>
    {
        await down(db);

        expect(await catalogNames(db, kind, 'index')).not.toContain(INDEX_NAME);
        expect(await catalogNames(db, kind, 'table')).toContain('node');
    });
});

//----------------------------------------------------------------------------------------------------------------------
