//----------------------------------------------------------------------------------------------------------------------
// Migration 009 — audit timestamp names
//
// Stands a database up at 008 with rows written under the _at names, runs the migration, and asserts the columns
// answer to their new names with every value intact. Runs against whichever dialect the suite is pointed at, since a
// column rename is one more thing the two dialects implement differently.
//----------------------------------------------------------------------------------------------------------------------

/* eslint-disable camelcase -- table names and rows are snake_case DB identifiers */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { type Kysely, sql } from 'kysely';

// Models
import type { DatabaseKind } from '@fileshed/core';

// Resource Access
import type { Database } from '@server/resource-access/database/database.ts';
import { migrateTo, migrateToLatest } from '@server/resource-access/database/migrator.ts';

// Support
import { testConfig } from '../../../auth/support.ts';
import { openTestDatabase } from '../../../support/database.ts';

//----------------------------------------------------------------------------------------------------------------------
// Fixtures
//----------------------------------------------------------------------------------------------------------------------

const BEFORE_THIS_ONE = '008_natural_name_collation';

const CREATED = '2026-01-02T03:04:05.000Z';
const UPDATED = '2026-02-03T04:05:06.000Z';
const DELETED = '2026-03-04T05:06:07.000Z';

// Every app table's audit timestamps, by the names they take.
const renamedColumns : Record<string, string[]> = {
    blob: [ 'created', 'deleted' ],
    instance_setting: [ 'updated' ],
    node: [ 'created', 'updated' ],
    share: [ 'created' ],
    share_request: [ 'created' ],
    public_link: [ 'created' ],
    deletion_offer: [ 'created' ],
};

// Stands in for the table BetterAuth's migrator owns in production, carrying just the columns FileShed reads.
const createUserStub = async (db : Kysely<Database>) : Promise<void> =>
{
    await db.schema
        .createTable('user')
        .addColumn('id', 'text', (col) => col.primaryKey())
        .addColumn('name', 'text', (col) => col.notNull())
        .addColumn('email', 'text', (col) => col.notNull())
        .addColumn('role', 'text', (col) => col.notNull().defaultTo('user'))
        .addColumn('banned', 'integer')
        .addColumn('createdAt', 'text', (col) => col.notNull())
        .addColumn('quota_limit', 'integer')
        .addColumn('preferences', 'text')
        .execute();
};

// One row in each table that carries more than one renamed column, written the way the pre-009 schema held them. Raw
// SQL because the table types spell the new names.
const seedLegacyRows = async (db : Kysely<Database>) : Promise<void> =>
{
    await db
        .insertInto('user')
        .values({ id: 'u1', name: 'u1', email: 'u1@t.test', role: 'user', createdAt: CREATED })
        .execute();

    await db
        .insertInto('storage_backend')
        .values({ id: 'be1', kind: 'fs', config: '{}', is_default: 1 })
        .execute();

    await sql`
        insert into blob (sha256, size, backend_id, storage_key, created_at, deleted_at)
        values ('sha-a', 10, 'be1', 'key/sha-a', ${ CREATED }, ${ DELETED })
    `.execute(db);

    await sql`
        insert into node (id, type, name, owner_id, created_at, updated_at)
        values ('folder1', 'folder', 'Reports', 'u1', ${ CREATED }, ${ UPDATED })
    `.execute(db);

    await sql`
        insert into instance_setting (key, value, updated_at)
        values ('INSTANCE_NAME', '"Shed"', ${ UPDATED })
    `.execute(db);
};

const columnsByTable = async (db : Kysely<Database>) : Promise<Map<string, string[]>> =>
{
    const tables = await db.introspection.getTables();

    return new Map(tables.map((table) => [ table.name, table.columns.map((column) => column.name) ]));
};

const indexNames = async (db : Kysely<Database>, kind : DatabaseKind) : Promise<string[]> =>
{
    const query = kind === 'postgres'
        ? sql<{ name : string }>`select indexname as name from pg_indexes where schemaname = current_schema()`
        : sql<{ name : string }>`select name from sqlite_master where type = 'index'`;

    const result = await query.execute(db);

    return result.rows.map((row) => row.name);
};

// SQLite hands a timestamp back as ISO text, Postgres as a Date; the instant is what has to survive.
const instantOf = (value : string | Date | null) : string | null =>
{
    return value === null ? null : new Date(value).toISOString();
};

//----------------------------------------------------------------------------------------------------------------------

let db : Kysely<Database>;
let kind : DatabaseKind;
let dispose : () => Promise<void>;

beforeEach(async () =>
{
    const opened = await openTestDatabase(testConfig());
    db = opened.handle.db;
    kind = opened.handle.kind;
    dispose = opened.dispose;

    await createUserStub(db);
    await migrateTo(db, kind, BEFORE_THIS_ONE);
    await seedLegacyRows(db);
});

afterEach(async () =>
{
    await dispose();
});

//----------------------------------------------------------------------------------------------------------------------

describe('migration 009 — audit timestamp names', () =>
{
    it('names every app table\'s audit timestamps without the _at suffix', async () =>
    {
        await migrateToLatest(db, kind);

        const columns = await columnsByTable(db);
        for(const [ table, names ] of Object.entries(renamedColumns))
        {
            for(const name of names)
            {
                expect(columns.get(table), table).toContain(name);
                expect(columns.get(table), table).not.toContain(`${ name }_at`);
            }
        }
    });

    it('keeps every value it renames', async () =>
    {
        await migrateToLatest(db, kind);

        const blob = await db.selectFrom('blob').select([ 'created', 'deleted' ])
            .executeTakeFirstOrThrow();
        const node = await db.selectFrom('node').select([ 'created', 'updated' ])
            .executeTakeFirstOrThrow();
        const setting = await db.selectFrom('instance_setting').select('updated')
            .executeTakeFirstOrThrow();

        expect(instantOf(blob.created)).toBe(CREATED);
        expect(instantOf(blob.deleted)).toBe(DELETED);
        expect(instantOf(node.created)).toBe(CREATED);
        expect(instantOf(node.updated)).toBe(UPDATED);
        expect(instantOf(setting.updated)).toBe(UPDATED);
    });

    it('rebuilds the blob graveyard index on the renamed column', async () =>
    {
        await migrateToLatest(db, kind);

        const indexes = await indexNames(db, kind);

        expect(indexes).toContain('blob_deleted_idx');
        expect(indexes).not.toContain('blob_deleted_at_idx');
    });

    it('puts the _at names and the old index back when rolled back', async () =>
    {
        await migrateToLatest(db, kind);
        await migrateTo(db, kind, BEFORE_THIS_ONE);

        const columns = await columnsByTable(db);
        expect(columns.get('node')).toEqual(expect.arrayContaining([ 'created_at', 'updated_at' ]));
        expect(columns.get('blob')).toEqual(expect.arrayContaining([ 'created_at', 'deleted_at' ]));
        expect(await indexNames(db, kind)).toContain('blob_deleted_at_idx');
    });
});

//----------------------------------------------------------------------------------------------------------------------
