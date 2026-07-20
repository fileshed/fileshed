//----------------------------------------------------------------------------------------------------------------------
// Blob GC — runGcOnce
//
// Drives the GC sweep against a real BlobRA (fs facade under a per-run temp dir) and a real in-memory database, zero
// mocks. Expectations: a blob graveyarded past the grace window loses both row and bytes; one still inside the window,
// and one still live, are untouched. Byte deletion is checked through the RA.
//----------------------------------------------------------------------------------------------------------------------

/* eslint-disable camelcase -- seed helpers build snake_case DB rows (house convention for Kysely inserts) */

import { createHash, randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Kysely } from 'kysely';

// Resource Access
import { BlobNotFoundError, BlobRA } from '@server/resource-access/blob/index.ts';
import { seedDefaultBackend } from '@server/resource-access/database/seeds.ts';
import type { Database, DatabaseHandle } from '@server/resource-access/database/database.ts';

// Managers
import { runGcOnce } from '@server/managers/gc.ts';

// Support
import { createTestDatabase } from '../resource-access/nodes/support.ts';
import { testConfig } from '../auth/support.ts';

//----------------------------------------------------------------------------------------------------------------------

const GRACE_MS = 7 * 24 * 60 * 60 * 1000;

let handle : DatabaseHandle;
let db : Kysely<Database>;
let blob : BlobRA;
let backendID : string;
let storageRoot : string;

function sha256Of(data : Buffer) : string
{
    return createHash('sha256')
        .update(data)
        .digest('hex');
}

// Write real bytes through the storage RA and record its blob row with a chosen graveyard marker. Returns the sha256.
async function seedStoredBlob(deletedAt : string | null) : Promise<string>
{
    const bytes = randomBytes(256);
    const sha256 = sha256Of(bytes);

    const location = await blob.put(sha256, Readable.from(bytes), bytes.length);
    await db
        .insertInto('blob')
        .values({
            sha256,
            size: bytes.length,
            backend_id: location.backendID,
            storage_key: location.storageKey,
            created_at: new Date().toISOString(),
            deleted_at: deletedAt,
        })
        .execute();

    return sha256;
}

async function rowExists(sha256 : string) : Promise<boolean>
{
    const row = await db.selectFrom('blob').select('sha256')
        .where('sha256', '=', sha256)
        .executeTakeFirst();
    return row !== undefined;
}

async function bytesExist(sha256 : string) : Promise<boolean>
{
    try
    {
        await blob.getStream({ backendID, storageKey: sha256 });
        return true;
    }
    catch(error)
    {
        if(error instanceof BlobNotFoundError) { return false; }
        throw error;
    }
}

beforeEach(async () =>
{
    storageRoot = await mkdtemp(join(tmpdir(), 'fileshed-gc-'));

    handle = await createTestDatabase();
    db = handle.db;
    backendID = await seedDefaultBackend(handle, testConfig({ STORAGE_ROOT: storageRoot }));
    blob = new BlobRA(handle);
});

afterEach(async () =>
{
    await db.destroy();
    await rm(storageRoot, { recursive: true, force: true });
});

//----------------------------------------------------------------------------------------------------------------------

describe('runGcOnce', () =>
{
    it('hard-deletes bytes and row for a blob graveyarded past the grace window, keeping the rest', async () =>
    {
        const expired = await seedStoredBlob(new Date('2020-01-01T00:00:00.000Z').toISOString());
        const inGrace = await seedStoredBlob(new Date(Date.now() - 60_000).toISOString());
        const live = await seedStoredBlob(null);

        const summary = await runGcOnce({ handle, blob, graceMs: GRACE_MS });

        expect(summary).toEqual({ candidates: 1, deleted: 1, kept: 0, bytesFailed: 0 });

        expect(await rowExists(expired)).toBe(false);
        expect(await bytesExist(expired)).toBe(false);

        expect(await rowExists(inGrace)).toBe(true);
        expect(await bytesExist(inGrace)).toBe(true);

        expect(await rowExists(live)).toBe(true);
        expect(await bytesExist(live)).toBe(true);
    });

    it('does nothing when there are no expired candidates', async () =>
    {
        const live = await seedStoredBlob(null);

        const summary = await runGcOnce({ handle, blob, graceMs: GRACE_MS });

        expect(summary).toEqual({ candidates: 0, deleted: 0, kept: 0, bytesFailed: 0 });
        expect(await rowExists(live)).toBe(true);
        expect(await bytesExist(live)).toBe(true);
    });

    // One failing byte delete must not abort the batch: the row is already gone (row-first design), so the other
    // candidates still sweep and the summary reports the leak honestly instead of the whole run throwing.
    it('sweeps the remaining candidates and reports a byte-delete failure without aborting', async () =>
    {
        const failing = await seedStoredBlob(new Date('2020-01-01T00:00:00.000Z').toISOString());
        const succeeding = await seedStoredBlob(new Date('2020-01-01T00:00:00.000Z').toISOString());

        // Fail only the one byte delete; the row queries and the other delete still run for real on the same RA.
        const realDelete = new BlobRA(handle);
        vi.spyOn(blob, 'delete').mockImplementation(async (location) =>
        {
            if(location.storageKey === failing) { throw new Error('EACCES: simulated'); }
            await realDelete.delete(location);
        });

        const summary = await runGcOnce({ handle, blob, graceMs: GRACE_MS });

        expect(summary).toEqual({ candidates: 2, deleted: 1, kept: 0, bytesFailed: 1 });

        expect(await rowExists(failing)).toBe(false);
        expect(await bytesExist(failing)).toBe(true);

        expect(await rowExists(succeeding)).toBe(false);
        expect(await bytesExist(succeeding)).toBe(false);
    });
});

//----------------------------------------------------------------------------------------------------------------------
