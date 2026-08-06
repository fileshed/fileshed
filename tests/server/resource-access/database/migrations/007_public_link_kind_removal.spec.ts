//----------------------------------------------------------------------------------------------------------------------
// Migration 007 — public link kind removal
//
// Stands a database up at 006, mints public_link rows the way the old schema held them -- a view/inline one and a
// revoked download/attachment one -- then runs the migration and asserts the links themselves came through whole while
// the kind columns went away. Runs against whichever dialect the suite is pointed at, since dropping a column is one
// of the few things Postgres and SQLite genuinely do differently.
//----------------------------------------------------------------------------------------------------------------------

/* eslint-disable camelcase -- rows are snake_case DB columns (house convention for Kysely inserts) */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { type Kysely, sql } from 'kysely';

// Resource Access
import type { Database } from '@server/resource-access/database/database.ts';
import { migrateTo, migrateToLatest } from '@server/resource-access/database/migrator.ts';

// Support
import { testConfig } from '../../../auth/support.ts';
import { openTestDatabase } from '../../../support/database.ts';

//----------------------------------------------------------------------------------------------------------------------
// Fixtures
//----------------------------------------------------------------------------------------------------------------------

const BEFORE_THIS_ONE = '006_name_ordering_index';

const isoNow = () : string => new Date().toISOString();

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

// A file node for the links to hang off, with the backend and blob its FKs demand.
const seedFile = async (db : Kysely<Database>, id : string) : Promise<void> =>
{
    await db
        .insertInto('user')
        .values({ id: 'u1', name: 'u1', email: 'u1@t.test', role: 'user', createdAt: isoNow() })
        .execute();

    await db
        .insertInto('storage_backend')
        .values({ id: 'be1', kind: 'fs', config: '{}', is_default: 1 })
        .execute();

    await db
        .insertInto('blob')
        .values({ sha256: 'sha-a', size: 10, backend_id: 'be1', storage_key: 'key/sha-a', created_at: isoNow() })
        .execute();

    await db
        .insertInto('node')
        .values({
            id,
            type: 'file',
            name: 'report.pdf',
            owner_id: 'u1',
            blob_id: 'sha-a',
            size: 10,
            mime_type: 'application/pdf',
            created_at: isoNow(),
            updated_at: isoNow(),
        })
        .execute();
};

// A link as the pre-007 schema held it. Raw SQL because the kind columns are gone from the table type -- writing them
// through Kysely is exactly what no longer type-checks, which is the point.
interface LegacyLink
{
    id : string;
    nodeID : string;
    token : string;
    mode : string;
    disposition : string;
    revokedAt : string | null;
}

const seedLegacyLink = async (db : Kysely<Database>, link : LegacyLink) : Promise<void> =>
{
    await sql`
        insert into public_link (id, node_id, token, mode, disposition, created_at, revoked_at)
        values (
            ${ link.id }, ${ link.nodeID }, ${ link.token },
            ${ link.mode }, ${ link.disposition },
            ${ isoNow() }, ${ link.revokedAt }
        )
    `.execute(db);
};

const columnsOf = async (db : Kysely<Database>, table : string) : Promise<string[]> =>
{
    const tables = await db.introspection.getTables();
    const found = tables.find((candidate) => candidate.name === table);

    return (found?.columns ?? []).map((column) => column.name).sort();
};

//----------------------------------------------------------------------------------------------------------------------

let db : Kysely<Database>;
let kind : 'postgres' | 'sqlite';
let dispose : () => Promise<void>;

beforeEach(async () =>
{
    const opened = await openTestDatabase(testConfig());
    db = opened.handle.db;
    kind = opened.handle.kind;
    dispose = opened.dispose;

    await createUserStub(db);
    await migrateTo(db, kind, BEFORE_THIS_ONE);
    await seedFile(db, 'file1');
});

afterEach(async () =>
{
    await dispose();
});

//----------------------------------------------------------------------------------------------------------------------

describe('migration 007 — public link kind removal', () =>
{
    it('drops mode and disposition, leaving the rest of the link untouched', async () =>
    {
        await migrateToLatest(db, kind);

        expect(await columnsOf(db, 'public_link'))
            .toEqual([ 'created_at', 'id', 'node_id', 'revoked_at', 'token' ]);
    });

    it('carries every link through the drop — no row, token, or target is lost', async () =>
    {
        await seedLegacyLink(db, {
            id: 'l1',
            nodeID: 'file1',
            token: 'tok-inline',
            mode: 'view',
            disposition: 'inline',
            revokedAt: null,
        });
        await seedLegacyLink(db, {
            id: 'l2',
            nodeID: 'file1',
            token: 'tok-download',
            mode: 'download',
            disposition: 'attachment',
            revokedAt: null,
        });

        await migrateToLatest(db, kind);

        const rows = await db
            .selectFrom('public_link')
            .select([ 'id', 'node_id', 'token' ])
            .orderBy('token', 'asc')
            .execute();

        expect(rows).toEqual([
            { id: 'l2', node_id: 'file1', token: 'tok-download' },
            { id: 'l1', node_id: 'file1', token: 'tok-inline' },
        ]);
    });

    // A link's kind is gone but its death is not: whatever was revoked before the migration is still revoked after it.
    it('keeps a revoked link revoked and a live link live', async () =>
    {
        const revokedAt = new Date('2026-03-01T00:00:00.000Z').toISOString();
        await seedLegacyLink(db, {
            id: 'live',
            nodeID: 'file1',
            token: 'tok-live',
            mode: 'view',
            disposition: 'inline',
            revokedAt: null,
        });
        await seedLegacyLink(db, {
            id: 'dead',
            nodeID: 'file1',
            token: 'tok-dead',
            mode: 'download',
            disposition: 'attachment',
            revokedAt,
        });

        await migrateToLatest(db, kind);

        const rows = await db
            .selectFrom('public_link')
            .select([ 'id', 'revoked_at' ])
            .orderBy('id', 'asc')
            .execute();

        expect(rows.map((row) => row.id)).toEqual([ 'dead', 'live' ]);
        expect(rows[0]?.revoked_at).not.toBeNull();
        expect(rows[1]?.revoked_at).toBeNull();
    });

    // Nothing may put a kind back: the columns are gone, so a write naming one is rejected by the database itself.
    it('leaves no column for a kind to be written to', async () =>
    {
        await migrateToLatest(db, kind);

        await expect(seedLegacyLink(db, {
            id: 'l3',
            nodeID: 'file1',
            token: 'tok-late',
            mode: 'view',
            disposition: 'inline',
            revokedAt: null,
        })).rejects.toThrow();
    });
});

//----------------------------------------------------------------------------------------------------------------------
