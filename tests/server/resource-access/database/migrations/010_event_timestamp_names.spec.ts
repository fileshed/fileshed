//----------------------------------------------------------------------------------------------------------------------
// Migration 010 — event timestamp names
//
// Stands a database up at 009 with rows written under the _at names, runs the migration, and asserts the columns
// answer to their new names with every value and every CHECK constraint on them intact. Runs against whichever
// dialect the suite is pointed at, since a column rename is one more thing the two dialects implement differently.
//----------------------------------------------------------------------------------------------------------------------

/* eslint-disable camelcase -- table names and rows are snake_case DB identifiers */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { type Kysely, sql } from 'kysely';

// Models
import type { DatabaseKind } from '@fileshed/core';

// Resource Access
import type { Database } from '@server/resource-access/database/database.ts';
import { migrateTo } from '@server/resource-access/database/migrator.ts';

// Support
import { testConfig } from '../../../auth/support.ts';
import { openTestDatabase } from '../../../support/database.ts';

//----------------------------------------------------------------------------------------------------------------------
// Fixtures
//----------------------------------------------------------------------------------------------------------------------

const BEFORE_THIS_ONE = '009_audit_timestamp_names';
const THIS_ONE = '010_event_timestamp_names';

const CREATED = '2026-01-02T03:04:05.000Z';
const TRASHED = '2026-02-03T04:05:06.000Z';
const REVOKED = '2026-03-04T05:06:07.000Z';
const RESOLVED = '2026-04-05T06:07:08.000Z';
const EXPIRES = '2026-05-06T07:08:09.000Z';

// Each renamed column, by its table and the name it takes.
const renamedColumns : Record<string, string> = {
    node: 'trashed',
    public_link: 'revoked',
    share_request: 'resolved',
    deletion_offer: 'expires',
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

// One row in each table that carries a renamed column, written the way the pre-010 schema held them. Raw SQL because
// the table types spell the new names.
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
        insert into blob (sha256, size, backend_id, storage_key, created)
        values ('sha-a', 10, 'be1', 'key/sha-a', ${ CREATED })
    `.execute(db);

    await sql`
        insert into node (id, type, name, owner_id, created, updated, trashed_at)
        values ('folder1', 'folder', 'Reports', 'u1', ${ CREATED }, ${ CREATED }, ${ TRASHED })
    `.execute(db);

    await sql`
        insert into public_link (id, node_id, token, created, revoked_at)
        values ('link1', 'folder1', 'tok-1', ${ CREATED }, ${ REVOKED })
    `.execute(db);

    await sql`
        insert into share_request (id, node_id, requester_id, requested_role, status, created, resolved_at)
        values ('request1', 'folder1', 'u1', 'viewer', 'granted', ${ CREATED }, ${ RESOLVED })
    `.execute(db);

    await sql`
        insert into deletion_offer (id, sha256, offeree_id, name, mime_type, size, created_by, created, expires_at)
        values ('offer1', 'sha-a', 'u1', 'report.pdf', 'application/pdf', 10, 'u1', ${ CREATED }, ${ EXPIRES })
    `.execute(db);
};

const columnsByTable = async (db : Kysely<Database>) : Promise<Map<string, string[]>> =>
{
    const tables = await db.introspection.getTables();

    return new Map(tables.map((table) => [ table.name, table.columns.map((column) => column.name) ]));
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

describe('migration 010 — event timestamp names', () =>
{
    it('names the trashed, revoked, resolved and expiry timestamps without the _at suffix', async () =>
    {
        await migrateTo(db, kind, THIS_ONE);

        const columns = await columnsByTable(db);
        for(const [ table, name ] of Object.entries(renamedColumns))
        {
            expect(columns.get(table), table).toContain(name);
            expect(columns.get(table), table).not.toContain(`${ name }_at`);
        }
    });

    it('keeps every value it renames', async () =>
    {
        await migrateTo(db, kind, THIS_ONE);

        const node = await db.selectFrom('node').select('trashed')
            .executeTakeFirstOrThrow();
        const link = await db.selectFrom('public_link').select('revoked')
            .executeTakeFirstOrThrow();
        const request = await db.selectFrom('share_request').select('resolved')
            .executeTakeFirstOrThrow();
        const offer = await db.selectFrom('deletion_offer').select('expires')
            .executeTakeFirstOrThrow();

        expect(instantOf(node.trashed)).toBe(TRASHED);
        expect(instantOf(link.revoked)).toBe(REVOKED);
        expect(instantOf(request.resolved)).toBe(RESOLVED);
        expect(instantOf(offer.expires)).toBe(EXPIRES);
    });

    // Both CHECKs name a renamed column: a link may never be trashed, and a request is resolved exactly when it has
    // left pending. The rename must carry them over, not drop them or leave them pointing at a column that is gone.
    it('keeps the CHECK constraints binding on the renamed columns', async () =>
    {
        await migrateTo(db, kind, THIS_ONE);

        const trashedLink = db
            .insertInto('node')
            .values({
                id: 'link1',
                type: 'link',
                name: 'Reports',
                owner_id: 'u1',
                target_node_id: 'folder1',
                created: CREATED,
                updated: CREATED,
                trashed: TRASHED,
            })
            .execute();
        const resolvedPending = db
            .insertInto('share_request')
            .values({
                id: 'request2',
                node_id: 'folder1',
                requester_id: 'u1',
                requested_role: 'viewer',
                message: null,
                status: 'pending',
                created: CREATED,
                resolved: RESOLVED,
            })
            .execute();

        await expect(trashedLink).rejects.toThrow(/node_variant_fields_check/);
        await expect(resolvedPending).rejects.toThrow(/share_request_resolution_check/);
    });

    it('puts the _at names back when rolled back', async () =>
    {
        await migrateTo(db, kind, THIS_ONE);
        await migrateTo(db, kind, BEFORE_THIS_ONE);

        const columns = await columnsByTable(db);
        for(const [ table, name ] of Object.entries(renamedColumns))
        {
            expect(columns.get(table), table).toContain(`${ name }_at`);
            expect(columns.get(table), table).not.toContain(name);
        }
    });
});

//----------------------------------------------------------------------------------------------------------------------
