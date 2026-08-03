//----------------------------------------------------------------------------------------------------------------------
// Node Resource-Access Test Support
//
// Shared fixtures for the nodes specs: a real in-memory SQLite database (the production factory + migrator, so PRAGMA
// foreign_keys and the CHECK constraints behave exactly as deployed -- zero mocks), the handful of raw upstream rows
// the node FKs depend on (a user, a storage backend, a blob), and domain-shaped Node factories for building trees.
//----------------------------------------------------------------------------------------------------------------------

/* eslint-disable camelcase -- seed helpers build snake_case DB rows (house convention for Kysely inserts) */

import type { Kysely } from 'kysely';

// Models
import type { FileNode, FolderNode, LinkNode } from '@fileshed/core';

// Resource Access
import type { Database, DatabaseHandle, DatabaseKind } from '@server/resource-access/database/database.ts';
import { migrateToLatest } from '@server/resource-access/database/migrator.ts';
import {
    bigIntType,
    boolDefault,
    boolType,
    timestampType,
} from '@server/resource-access/database/migrations/columns.ts';

// Utils
import type { Config } from '@server/utils/config.ts';

// Test support
import { openTestDatabase, testDatabaseKind } from '../../support/database.ts';

//----------------------------------------------------------------------------------------------------------------------
// Database
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
    TRASH_PURGE_DAYS: 30,
    UPLOAD_MAX_BYTES: 5 * 1024 * 1024 * 1024,
};

// Stands in for BetterAuth's user table (which its migrator owns in production), carrying just the columns FileShed
// reads, so the app-table FKs to user.id resolve. Mirrors the migration spec's stub.
async function createUserStub(db : Kysely<Database>, kind : DatabaseKind) : Promise<void>
{
    await db.schema
        .createTable('user')
        .addColumn('id', 'text', (col) => col.primaryKey())
        .addColumn('name', 'text', (col) => col.notNull())
        .addColumn('email', 'text', (col) => col.notNull())
        .addColumn('image', 'text')
        .addColumn('role', 'text', (col) => col.notNull().defaultTo('user'))
        .addColumn('banned', boolType(kind))
        .addColumn('banReason', 'text')
        .addColumn('banExpires', timestampType(kind))
        .addColumn('createdAt', timestampType(kind), (col) => col.notNull())
        .addColumn('quota_limit', bigIntType(kind))
        .addColumn('preferences', 'text')
        .addColumn('avatar_sha256', 'text')
        .addColumn('avatar_mime', 'text')
        .execute();
}

// A fresh, fully migrated database. The caller owns the handle and destroys it when the test ends.
export async function createTestDatabase() : Promise<DatabaseHandle>
{
    const { handle } = await openTestDatabase(testConfig);
    await createUserStub(handle.db, handle.kind);
    await migrateToLatest(handle.db, handle.kind);
    return handle;
}

//----------------------------------------------------------------------------------------------------------------------
// Upstream row seeds (raw -- these tables are owned by other layers)
//----------------------------------------------------------------------------------------------------------------------

const isoNow = () : string => new Date().toISOString();

export async function seedUser(
    db : Kysely<Database>,
    id : string,
    extra : { name ?: string; avatarSha256 ?: string | null; quotaLimit ?: number | null } = {}
) : Promise<void>
{
    await db
        .insertInto('user')
        .values({
            id,
            name: extra.name ?? id,
            email: `${ id }@t.test`,
            avatar_sha256: extra.avatarSha256 ?? null,
            quota_limit: extra.quotaLimit ?? null,
            role: 'user',
            createdAt: isoNow(),
        })
        .execute();
}

// Move an existing user's cap, the way an admin patching their quota does. The user row is the only place a quota
// lives, so this is how a spec states one -- and the only way to change one mid-test, which is what a spec about a
// quota change taking effect needs.
export async function setUserQuota(
    db : Kysely<Database>,
    userID : string,
    quotaLimit : number | null
) : Promise<void>
{
    await db
        .updateTable('user')
        .set({ quota_limit: quotaLimit })
        .where('id', '=', userID)
        .execute();
}

export async function seedBackend(db : Kysely<Database>, id : string) : Promise<void>
{
    await db
        .insertInto('storage_backend')
        .values({ id, kind: 'fs', config: '{}', is_default: boolDefault(testDatabaseKind(), true) })
        .execute();
}

export async function seedBlob(db : Kysely<Database>, sha256 : string, backendID : string) : Promise<void>
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
}

//----------------------------------------------------------------------------------------------------------------------
// Domain Node factories
//----------------------------------------------------------------------------------------------------------------------

const epoch = new Date('2026-01-02T03:04:05.678Z');

interface FolderInit
{
    id : string;
    ownerID : string;
    parentID ?: string | null;
    name ?: string;
    createdAt ?: Date;
    updatedAt ?: Date;
    trashedAt ?: Date | null;
}

export function folderNode(init : FolderInit) : FolderNode
{
    return {
        type: 'folder',
        id: init.id,
        name: init.name ?? init.id,
        ownerID: init.ownerID,
        parentID: init.parentID ?? null,
        createdAt: init.createdAt ?? epoch,
        updatedAt: init.updatedAt ?? epoch,
        trashedAt: init.trashedAt ?? null,
    };
}

interface FileInit
{
    id : string;
    ownerID : string;
    blobID : string;
    size ?: number;
    mimeType ?: string;
    parentID ?: string | null;
    name ?: string;
    createdAt ?: Date;
    updatedAt ?: Date;
    trashedAt ?: Date | null;
}

export function fileNode(init : FileInit) : FileNode
{
    return {
        type: 'file',
        id: init.id,
        name: init.name ?? init.id,
        ownerID: init.ownerID,
        parentID: init.parentID ?? null,
        blobID: init.blobID,
        size: init.size ?? 10,
        mimeType: init.mimeType ?? 'text/plain',
        createdAt: init.createdAt ?? epoch,
        updatedAt: init.updatedAt ?? epoch,
        trashedAt: init.trashedAt ?? null,
    };
}

interface LinkInit
{
    id : string;
    ownerID : string;
    targetNodeID : string;
    parentID ?: string | null;
    name ?: string;
    createdAt ?: Date;
    updatedAt ?: Date;
}

export function linkNode(init : LinkInit) : LinkNode
{
    return {
        type: 'link',
        id: init.id,
        name: init.name ?? init.id,
        ownerID: init.ownerID,
        parentID: init.parentID ?? null,
        targetNodeID: init.targetNodeID,
        createdAt: init.createdAt ?? epoch,
        updatedAt: init.updatedAt ?? epoch,
    };
}

//----------------------------------------------------------------------------------------------------------------------
