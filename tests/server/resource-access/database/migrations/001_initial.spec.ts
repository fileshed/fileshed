//----------------------------------------------------------------------------------------------------------------------
// Migration 001 — schema invariants
//
// Runs migration 001 against a fresh in-memory SQLite database (via the real factory, so PRAGMA foreign_keys is wired
// exactly as production) and asserts the layer-3 invariants actually BEHAVE: the per-type node
// CHECK constraints, the share/share_request domain CHECKs, the ON DELETE CASCADE edges, and full reversibility of the
// migration. Every expectation is derived from the requirement, not from what the DDL happens to do.
//----------------------------------------------------------------------------------------------------------------------

/* eslint-disable camelcase -- rows are snake_case DB columns (house convention for Kysely inserts) */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { Kysely } from 'kysely';

// Resource Access
import {
    type Database,
    type DatabaseHandle,
    type ShareTable,
    createDatabase,
} from '@server/resource-access/database/database.ts';
import { migrateDown, migrateToLatest } from '@server/resource-access/database/migrator.ts';

// Utils
import type { Config } from '@server/utils/config.ts';

//----------------------------------------------------------------------------------------------------------------------
// Fixtures
//----------------------------------------------------------------------------------------------------------------------

const testConfig : Config = {
    HOST: '127.0.0.1',
    PORT: 3000,
    DATABASE_KIND: 'sqlite',
    DATABASE_PATH: ':memory:',
    AUTH_SECRET: 'test-auth-secret-at-least-32-chars-long',
    BASE_URL: 'http://localhost:5173',
    STORAGE_ROOT: './data/blobs',
    GC_GRACE_DAYS: 7,
    GC_INTERVAL_MINUTES: 60,
    UPLOAD_MAX_BYTES: 5 * 1024 * 1024 * 1024,
};

const isoNow = () : string => new Date().toISOString();

// Stands in for the table BetterAuth's migrator owns in production. The specs create just the columns FileShed reads
// (matching UserTable) before running migration 001, so the app-table FKs to user.id resolve. In production BetterAuth
// creates the full table, including role (admin plugin) and quota_limit (additionalField).
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

const insertUser = async (db : Kysely<Database>, id : string) : Promise<void> =>
{
    await db
        .insertInto('user')
        .values({ id, name: id, email: `${ id }@t.test`, role: 'user', createdAt: new Date().toISOString() })
        .execute();
};

const insertBackend = async (db : Kysely<Database>, id : string) : Promise<void> =>
{
    await db
        .insertInto('storage_backend')
        .values({ id, kind: 'fs', config: '{}', is_default: 1 })
        .execute();
};

const insertBlob = async (db : Kysely<Database>, sha256 : string, backendID : string) : Promise<void> =>
{
    await db
        .insertInto('blob')
        .values({
            sha256,
            size: 10,
            backend_id: backendID,
            storage_key: `key/${ sha256 }`,
            created_at: isoNow(),
        })
        .execute();
};

const insertFolder = async (db : Kysely<Database>, id : string, ownerID : string) : Promise<void> =>
{
    await db
        .insertInto('node')
        .values({
            id,
            type: 'folder',
            name: id,
            owner_id: ownerID,
            created_at: isoNow(),
            updated_at: isoNow(),
        })
        .execute();
};

const insertFile = async (db : Kysely<Database>, id : string, ownerID : string, blobID : string) : Promise<void> =>
{
    await db
        .insertInto('node')
        .values({
            id,
            type: 'file',
            name: id,
            owner_id: ownerID,
            blob_id: blobID,
            size: 10,
            mime_type: 'text/plain',
            created_at: isoNow(),
            updated_at: isoNow(),
        })
        .execute();
};

const insertLink = async (db : Kysely<Database>, id : string, ownerID : string, targetID : string) : Promise<void> =>
{
    await db
        .insertInto('node')
        .values({
            id,
            type: 'link',
            name: id,
            owner_id: ownerID,
            target_node_id: targetID,
            created_at: isoNow(),
            updated_at: isoNow(),
        })
        .execute();
};

//----------------------------------------------------------------------------------------------------------------------

let handle : DatabaseHandle;
let db : Kysely<Database>;

beforeEach(async () =>
{
    handle = createDatabase(testConfig);
    db = handle.db;
    await createUserStub(db);
    await migrateToLatest(db, handle.kind);
});

afterEach(async () =>
{
    await db.destroy();
});

//----------------------------------------------------------------------------------------------------------------------
// Node per-type CHECK constraints
//----------------------------------------------------------------------------------------------------------------------

describe('migration 001 — node variant constraints', () =>
{
    it('accepts a well-formed file, folder, and link (so the rejections below are not vacuous)', async () =>
    {
        await insertUser(db, 'u1');
        await insertBackend(db, 'be1');
        await insertBlob(db, 'sha-a', 'be1');

        await insertFolder(db, 'folder1', 'u1');
        await insertFile(db, 'file1', 'u1', 'sha-a');
        await insertLink(db, 'link1', 'u1', 'folder1');

        const rows = await db
            .selectFrom('node')
            .select('id')
            .execute();

        expect(rows).toHaveLength(3);
    });

    it('rejects a folder that carries a size (folders have no logical size)', async () =>
    {
        await insertUser(db, 'u1');

        const insert = db
            .insertInto('node')
            .values({
                id: 'f1',
                type: 'folder',
                name: 'f1',
                owner_id: 'u1',
                size: 100,
                created_at: isoNow(),
                updated_at: isoNow(),
            })
            .execute();

        await expect(insert).rejects.toThrow(/node_variant_fields_check/);
    });

    it('rejects a link that carries a blob_id (links reference a target, never a blob)', async () =>
    {
        await insertUser(db, 'u1');
        await insertBackend(db, 'be1');
        await insertBlob(db, 'sha-a', 'be1');
        await insertFolder(db, 'target', 'u1');

        // blob_id points at a real blob, so only the variant CHECK — not the FK — can be what rejects this.
        const insert = db
            .insertInto('node')
            .values({
                id: 'l1',
                type: 'link',
                name: 'l1',
                owner_id: 'u1',
                target_node_id: 'target',
                blob_id: 'sha-a',
                created_at: isoNow(),
                updated_at: isoNow(),
            })
            .execute();

        await expect(insert).rejects.toThrow(/node_variant_fields_check/);
    });

    it('rejects a link that carries a trashed_at (links are deleted, never trashed)', async () =>
    {
        await insertUser(db, 'u1');
        await insertFolder(db, 'target', 'u1');

        const insert = db
            .insertInto('node')
            .values({
                id: 'l1',
                type: 'link',
                name: 'l1',
                owner_id: 'u1',
                target_node_id: 'target',
                trashed_at: isoNow(),
                created_at: isoNow(),
                updated_at: isoNow(),
            })
            .execute();

        await expect(insert).rejects.toThrow(/node_variant_fields_check/);
    });
});

//----------------------------------------------------------------------------------------------------------------------
// Share & share-request CHECK constraints
//----------------------------------------------------------------------------------------------------------------------

describe('migration 001 — share and share_request constraints', () =>
{
    it('rejects a share with role owner (owner is never a grant)', async () =>
    {
        await insertUser(db, 'owner');
        await insertUser(db, 'grantee');
        await insertFolder(db, 'n1', 'owner');

        const insert = db
            .insertInto('share')
            .values({
                id: 's1',
                node_id: 'n1',
                grantee_user_id: 'grantee',
                // Deliberately invalid role, cast past the column's literal union to reach the DB CHECK.
                role: 'owner' as unknown as ShareTable['role'],
                created_by: 'owner',
                created_at: isoNow(),
            })
            .execute();

        await expect(insert).rejects.toThrow(/CHECK constraint/i);
    });

    it('rejects a second grant for the same node and grantee (one grant per pair)', async () =>
    {
        await insertUser(db, 'owner');
        await insertUser(db, 'grantee');
        await insertFolder(db, 'n1', 'owner');

        await db
            .insertInto('share')
            .values({
                id: 's1',
                node_id: 'n1',
                grantee_user_id: 'grantee',
                role: 'viewer',
                created_by: 'owner',
                created_at: isoNow(),
            })
            .execute();

        const duplicate = db
            .insertInto('share')
            .values({
                id: 's2',
                node_id: 'n1',
                grantee_user_id: 'grantee',
                role: 'editor',
                created_by: 'owner',
                created_at: isoNow(),
            })
            .execute();

        await expect(duplicate).rejects.toThrow(/unique/i);
    });

    it('rejects a pending share_request that already carries a resolved_at', async () =>
    {
        await insertUser(db, 'requester');
        await insertUser(db, 'owner');
        await insertFolder(db, 'n1', 'owner');

        const insert = db
            .insertInto('share_request')
            .values({
                id: 'sr1',
                node_id: 'n1',
                requester_id: 'requester',
                requested_role: 'viewer',
                status: 'pending',
                created_at: isoNow(),
                resolved_at: isoNow(),
            })
            .execute();

        await expect(insert).rejects.toThrow(/share_request_resolution_check/);
    });
});

//----------------------------------------------------------------------------------------------------------------------
// Foreign keys & cascades
//----------------------------------------------------------------------------------------------------------------------

describe('migration 001 — foreign keys and cascades', () =>
{
    it('enforces foreign keys on SQLite (a node owned by a missing user is rejected)', async () =>
    {
        // Proves the factory turned PRAGMA foreign_keys ON; without it SQLite would silently accept the orphan.
        const insert = db
            .insertInto('node')
            .values({
                id: 'n1',
                type: 'folder',
                name: 'n1',
                owner_id: 'ghost',
                created_at: isoNow(),
                updated_at: isoNow(),
            })
            .execute();

        await expect(insert).rejects.toThrow(/FOREIGN KEY/i);
    });

    it('removes links to a node when that node is hard-deleted (target_node_id ON DELETE CASCADE)', async () =>
    {
        await insertUser(db, 'u1');
        await insertBackend(db, 'be1');
        await insertBlob(db, 'sha-a', 'be1');
        await insertFile(db, 'file1', 'u1', 'sha-a');
        await insertLink(db, 'link1', 'u1', 'file1');

        await db
            .deleteFrom('node')
            .where('id', '=', 'file1')
            .execute();

        const links = await db
            .selectFrom('node')
            .select('id')
            .where('id', '=', 'link1')
            .execute();

        expect(links).toHaveLength(0);
    });

    it('removes deletion offers when their blob is deleted (deletion_offer.sha256 ON DELETE CASCADE)', async () =>
    {
        await insertUser(db, 'u1');
        await insertBackend(db, 'be1');
        await insertBlob(db, 'sha-a', 'be1');

        await db
            .insertInto('deletion_offer')
            .values({
                id: 'do1',
                sha256: 'sha-a',
                offeree_id: 'u1',
                name: 'report.pdf',
                mime_type: 'application/pdf',
                size: 10,
                created_by: 'u1',
                created_at: isoNow(),
                expires_at: isoNow(),
            })
            .execute();

        await db
            .deleteFrom('blob')
            .where('sha256', '=', 'sha-a')
            .execute();

        const offers = await db
            .selectFrom('deletion_offer')
            .select('id')
            .execute();

        expect(offers).toHaveLength(0);
    });

    // A deleted user's outstanding offers void with them; without the cascade, a pending offer to someone else would
    // block the user delete for up to the GC grace window.
    it('removes deletion offers created by a deleted user (deletion_offer.created_by ON DELETE CASCADE)', async () =>
    {
        await insertUser(db, 'creator');
        await insertUser(db, 'offeree');
        await insertBackend(db, 'be1');
        await insertBlob(db, 'sha-b', 'be1');

        await db
            .insertInto('deletion_offer')
            .values({
                id: 'do2',
                sha256: 'sha-b',
                offeree_id: 'offeree',
                name: 'report.pdf',
                mime_type: 'application/pdf',
                size: 10,
                created_by: 'creator',
                created_at: isoNow(),
                expires_at: isoNow(),
            })
            .execute();

        await db
            .deleteFrom('user')
            .where('id', '=', 'creator')
            .execute();

        const offers = await db
            .selectFrom('deletion_offer')
            .select('id')
            .execute();

        expect(offers).toHaveLength(0);
    });
});

//----------------------------------------------------------------------------------------------------------------------
// Reversibility
//----------------------------------------------------------------------------------------------------------------------

describe('migration 001 — reversibility', () =>
{
    it('drops every app table and leaves the BetterAuth user table untouched', async () =>
    {
        await migrateDown(db, handle.kind);

        const names = (await db.introspection.getTables()).map((table) => table.name);
        const appTables = [
            'storage_backend',
            'blob',
            'node',
            'share',
            'share_request',
            'public_link',
            'deletion_offer',
        ];

        expect(appTables.filter((name) => names.includes(name))).toEqual([]);

        // user persists — 001 never touched it, BetterAuth owns it.
        expect(names).toContain('user');
    });
});

//----------------------------------------------------------------------------------------------------------------------
