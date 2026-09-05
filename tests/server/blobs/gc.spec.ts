//----------------------------------------------------------------------------------------------------------------------
// Blob GC — runGcOnce
//
// Drives the GC sweep against a real BlobRA (fs facade under a per-run temp dir) and a real in-memory database, zero
// mocks. Expectations: a blob graveyarded past the grace window loses both row and bytes; one still inside the window,
// and one still live, are untouched; and stored bytes no record accounts for are reclaimed once they have sat still
// long enough to be a leak rather than a commit in progress. Byte deletion is checked through the RA.
//----------------------------------------------------------------------------------------------------------------------

/* eslint-disable camelcase -- seed helpers build snake_case DB rows (house convention for Kysely inserts) */

import { createHash, randomBytes } from 'node:crypto';
import { mkdtemp, rm, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Kysely } from 'kysely';

// Models
import { ORPHAN_GRACE_MS } from '@fileshed/core';

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

// Every seeded blob is this size, so the bytes a sweep reports freed are a multiple of it and can be reasoned about
// by hand rather than read back off the summary.
const BLOB_BYTES = 256;

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

// Real bytes in the store with nothing in the record table naming them -- the state a write refused after its bytes
// were published leaves behind.
async function seedStoredBytes() : Promise<string>
{
    const bytes = randomBytes(BLOB_BYTES);
    const sha256 = sha256Of(bytes);

    await blob.put(sha256, Readable.from(bytes), bytes.length);

    return sha256;
}

// Write real bytes through the storage RA and record its blob row with a chosen graveyard marker. Returns the sha256.
async function seedStoredBlob(deletedAt : string | null) : Promise<string>
{
    const sha256 = await seedStoredBytes();

    await db
        .insertInto('blob')
        .values({
            sha256,
            size: BLOB_BYTES,
            backend_id: backendID,
            storage_key: sha256,
            created_at: new Date().toISOString(),
            deleted_at: deletedAt,
        })
        .execute();

    return sha256;
}

// Bytes just written are inside the reconciler's window on purpose -- a record for them may still be committing. Push
// them back past it, the way real bytes age while nobody is looking at them.
async function ageStoredBytes(sha256 : string) : Promise<void>
{
    const path = join(storageRoot, sha256.slice(0, 2), sha256.slice(2, 4), sha256);
    const aged = new Date(Date.now() - ORPHAN_GRACE_MS - 60_000);

    await utimes(path, aged, aged);
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

        const summary = await runGcOnce({ blob, graceMs: async () => GRACE_MS });

        expect(summary).toEqual({ candidates: 1, deleted: 1, kept: 0, bytesFailed: 0, bytesFreed: BLOB_BYTES });

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

        const summary = await runGcOnce({ blob, graceMs: async () => GRACE_MS });

        expect(summary).toEqual({ candidates: 0, deleted: 0, kept: 0, bytesFailed: 0, bytesFreed: 0 });
        expect(await rowExists(live)).toBe(true);
        expect(await bytesExist(live)).toBe(true);
    });

    // The grace window is an admin setting, so the sweep must read it per run rather than close over whatever it
    // was wired with: the same deps object, unchanged, has to change its verdict when the setting moves.
    it('reads the grace window afresh on every sweep, so a shortened window collects without a restart', async () =>
    {
        const graveyarded = await seedStoredBlob(new Date(Date.now() - 60_000).toISOString());

        let graceMs = GRACE_MS;
        const deps = { blob, graceMs: async () => graceMs };

        expect(await runGcOnce(deps)).toEqual({ candidates: 0, deleted: 0, kept: 0, bytesFailed: 0, bytesFreed: 0 });
        expect(await rowExists(graveyarded)).toBe(true);

        graceMs = 0;

        expect(await runGcOnce(deps))
            .toEqual({ candidates: 1, deleted: 1, kept: 0, bytesFailed: 0, bytesFreed: BLOB_BYTES });
        expect(await rowExists(graveyarded)).toBe(false);
        expect(await bytesExist(graveyarded)).toBe(false);
    });

    // One failing byte delete must not abort the batch: the row is already gone (row-first design), so the other
    // candidates still sweep and the summary reports the leak honestly instead of the whole run throwing. The leaked
    // candidate's size is not in the freed figure either -- its bytes are still sitting on the disk.
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

        const summary = await runGcOnce({ blob, graceMs: async () => GRACE_MS });

        expect(summary).toEqual({ candidates: 2, deleted: 1, kept: 0, bytesFailed: 1, bytesFreed: BLOB_BYTES });

        expect(await rowExists(failing)).toBe(false);
        expect(await bytesExist(failing)).toBe(true);

        expect(await rowExists(succeeding)).toBe(false);
        expect(await bytesExist(succeeding)).toBe(false);
    });

    // Bytes are published before the record referencing them commits, so a refusal in that commit -- or a crash --
    // leaves bytes nothing in the database mentions. Candidacy read from the record table cannot see them at all, so
    // the sweep looks from the other side too and reclaims what it finds.
    it('reclaims stored bytes that no record accounts for', async () =>
    {
        const orphan = await seedStoredBytes();
        await ageStoredBytes(orphan);

        const summary = await runGcOnce({ blob, graceMs: async () => GRACE_MS });

        expect(summary).toEqual({ candidates: 1, deleted: 1, kept: 0, bytesFailed: 0, bytesFreed: BLOB_BYTES });
        expect(await bytesExist(orphan)).toBe(false);
        expect(await rowExists(orphan)).toBe(false);
    });

    // The window is what separates bytes nothing will ever claim from bytes whose record is committing right now: an
    // upload that publishes and then commits is momentarily indistinguishable from a leak, and collecting it would
    // leave a live record pointing at nothing.
    it('leaves record-less bytes alone until they have sat untouched past the reconciling window', async () =>
    {
        const justWritten = await seedStoredBytes();

        const summary = await runGcOnce({ blob, graceMs: async () => GRACE_MS });

        expect(summary).toEqual({ candidates: 0, deleted: 0, kept: 0, bytesFailed: 0, bytesFreed: 0 });
        expect(await bytesExist(justWritten)).toBe(true);
    });

    // Age is not evidence. A blob written a year ago and referenced ever since is the ordinary case, and the only
    // thing that makes stored bytes collectable is that no record names them.
    it('never touches bytes a live record names, however long ago they were written', async () =>
    {
        const live = await seedStoredBlob(null);
        await ageStoredBytes(live);

        const summary = await runGcOnce({ blob, graceMs: async () => GRACE_MS });

        expect(summary).toEqual({ candidates: 0, deleted: 0, kept: 0, bytesFailed: 0, bytesFreed: 0 });
        expect(await rowExists(live)).toBe(true);
        expect(await bytesExist(live)).toBe(true);
    });
});

//----------------------------------------------------------------------------------------------------------------------
