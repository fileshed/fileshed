//----------------------------------------------------------------------------------------------------------------------
// Migration 004 — quota_limit zero remap
//
// Seeds accounts in their pre-migration states against a fresh in-memory SQLite database (the real factory and
// migrator, zero mocks), then runs the migration and asserts each state lands where the semantic flip requires.
//----------------------------------------------------------------------------------------------------------------------

/* eslint-disable camelcase -- rows are snake_case DB columns (house convention for Kysely inserts) */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { Kysely } from 'kysely';

// Models
import { UNLIMITED_QUOTA } from '@fileshed/core';

// Engines
import { effectiveQuota } from '@server/engines/quota.ts';

// Resource Access
import { type Database, type DatabaseHandle, createDatabase } from '@server/resource-access/database/database.ts';
import { migrateToLatest } from '@server/resource-access/database/migrator.ts';

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

// Stands in for the table BetterAuth's migrator owns in production, carrying just the columns FileShed reads.
// Mirrors the 001 spec's stub.
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

// Seeded before the migrator runs, so the row is genuinely pre-migration state rather than something written after.
const seedUser = async (db : Kysely<Database>, id : string, quotaLimit : number | null) : Promise<void> =>
{
    await db
        .insertInto('user')
        .values({
            id,
            name: id,
            email: `${ id }@t.test`,
            role: 'user',
            quota_limit: quotaLimit,
            createdAt: new Date().toISOString(),
        })
        .execute();
};

const quotaOf = async (db : Kysely<Database>, id : string) : Promise<number | null> =>
{
    const row = await db
        .selectFrom('user')
        .select('quota_limit')
        .where('id', '=', id)
        .executeTakeFirstOrThrow();

    return row.quota_limit;
};

//----------------------------------------------------------------------------------------------------------------------

let handle : DatabaseHandle;
let db : Kysely<Database>;

beforeEach(async () =>
{
    handle = createDatabase(testConfig);
    db = handle.db;
    await createUserStub(db);
});

afterEach(async () =>
{
    await db.destroy();
});

//----------------------------------------------------------------------------------------------------------------------

describe('migration 004 — quota_limit zero remap', () =>
{
    it('turns a legacy block-all 0 into a one-byte cap rather than unlimited', async () =>
    {
        await seedUser(db, 'blocked', 0);

        await migrateToLatest(db, handle.kind);

        expect(await quotaOf(db, 'blocked')).toBe(1);
    });

    it('leaves the migrated account enforceable, not resolved to unlimited', async () =>
    {
        await seedUser(db, 'blocked', 0);

        await migrateToLatest(db, handle.kind);

        // The whole point of the remap: under the new semantics a 0 would resolve to no cap at all, handing the
        // account the storage the operator explicitly denied.
        expect(effectiveQuota(await quotaOf(db, 'blocked'), UNLIMITED_QUOTA)).toBe(1);
    });

    it('leaves an account inheriting the instance default untouched', async () =>
    {
        await seedUser(db, 'inherits', null);

        await migrateToLatest(db, handle.kind);

        expect(await quotaOf(db, 'inherits')).toBeNull();
    });

    it('leaves a positive byte cap untouched', async () =>
    {
        await seedUser(db, 'capped', 4096);

        await migrateToLatest(db, handle.kind);

        expect(await quotaOf(db, 'capped')).toBe(4096);
    });
});

//----------------------------------------------------------------------------------------------------------------------
