//----------------------------------------------------------------------------------------------------------------------
// Upload Partials Reaper — runPartialsOnce
//
// Drives the sweep against a real BlobRA (fs facade under a per-run temp dir) over in-memory SQLite, zero mocks. Real
// staging files, aged by hand rather than by waiting, because the whole contract is which side of the cutoff a
// staging area sits on: staging untouched for longer than an upload ticket can live is abandoned, anything newer
// belongs to an upload that may still deliver its next chunk.
//----------------------------------------------------------------------------------------------------------------------

import { randomBytes } from 'node:crypto';
import { mkdir, mkdtemp, readdir, rm, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

// Models
import { MS_PER_MINUTE } from '@fileshed/core';

// Resource Access
import { BlobRA } from '@server/resource-access/blob/index.ts';
import type { DatabaseHandle } from '@server/resource-access/database/database.ts';
import { seedDefaultBackend } from '@server/resource-access/database/seeds.ts';

// Managers
import { runPartialsOnce } from '@server/managers/partials.ts';

// Support
import { createTestDatabase } from '../resource-access/nodes/support.ts';
import { testConfig } from '../auth/support.ts';

//----------------------------------------------------------------------------------------------------------------------

const TTL_MS = 30 * MS_PER_MINUTE;

let handle : DatabaseHandle;
let blob : BlobRA;
let storageRoot : string;
let partialsDir : string;

// Stage the first chunk of an upload nobody has finished, exactly as a chunked PUT would.
async function stagePartial(uploadID : string, size : number) : Promise<void>
{
    await blob.appendChunk(uploadID, Readable.from(randomBytes(size)), 0);
}

// Age everything currently staged. Staging is judged by when it was last touched, and a chunk landing is what touches
// it -- so backdating is the only honest way to say "no chunk has landed against this in an hour" inside a test.
async function ageStaging(byMs : number) : Promise<void>
{
    const touched = new Date(Date.now() - byMs);
    const staged = await readdir(partialsDir);

    await Promise.all(staged.map((name) => utimes(join(partialsDir, name), touched, touched)));
}

beforeEach(async () =>
{
    storageRoot = await mkdtemp(join(tmpdir(), 'fileshed-partials-'));
    partialsDir = join(storageRoot, '.partials');

    handle = await createTestDatabase();
    await seedDefaultBackend(handle, testConfig({ STORAGE_ROOT: storageRoot }));
    blob = new BlobRA(handle);

    await mkdir(partialsDir, { recursive: true });
});

afterEach(async () =>
{
    await handle.db.destroy();
    await rm(storageRoot, { recursive: true, force: true });
});

//----------------------------------------------------------------------------------------------------------------------

describe('runPartialsOnce', () =>
{
    it('reclaims the staging of an abandoned upload and reports the bytes it handed back', async () =>
    {
        await stagePartial('abandoned', 2000);
        await ageStaging(TTL_MS * 2);

        const summary = await runPartialsOnce({ blob, ttlMs: TTL_MS });

        expect(summary).toEqual({ candidates: 1, reclaimed: 1, failed: 0, bytesFreed: 2000 });
        expect(await readdir(partialsDir)).toEqual([]);
    });

    it('leaves an upload that is still delivering alone, and does not count it as a candidate', async () =>
    {
        await stagePartial('abandoned', 2000);
        await ageStaging(TTL_MS * 2);
        await stagePartial('delivering', 1000);

        const summary = await runPartialsOnce({ blob, ttlMs: TTL_MS });

        expect(summary).toEqual({ candidates: 1, reclaimed: 1, failed: 0, bytesFreed: 2000 });

        // The survivor is the live upload, whole: it goes on taking chunks where it left off.
        await blob.appendChunk('delivering', Readable.from(randomBytes(500)), 1000);
        expect(await readdir(partialsDir)).toHaveLength(1);
    });

    it('reports nothing on an instance where no chunked upload has ever run', async () =>
    {
        const summary = await runPartialsOnce({ blob, ttlMs: TTL_MS });

        expect(summary).toEqual({ candidates: 0, reclaimed: 0, failed: 0, bytesFreed: 0 });
    });

    // The window is what separates an abandoned upload from a slow one, so the same staging has to survive a sweep
    // whose window has not closed on it yet and go on the one whose window has.
    it('judges staging against the window it was given, not against everything staged', async () =>
    {
        await stagePartial('slow', 1500);
        await ageStaging(10 * MS_PER_MINUTE);

        expect(await runPartialsOnce({ blob, ttlMs: TTL_MS }))
            .toEqual({ candidates: 0, reclaimed: 0, failed: 0, bytesFreed: 0 });
        expect(await readdir(partialsDir)).toHaveLength(1);

        expect(await runPartialsOnce({ blob, ttlMs: 5 * MS_PER_MINUTE }))
            .toEqual({ candidates: 1, reclaimed: 1, failed: 0, bytesFreed: 1500 });
    });

    // One candidate that will not delete is counted and left where it is; the rest of the abandoned staging still
    // goes. Its size stays out of bytesFreed -- the space it holds was never handed back.
    it('isolates staging it cannot drop, reclaiming the rest and counting the failure', async () =>
    {
        await stagePartial('abandoned', 2000);

        // A directory where a staging file belongs: aged like everything else, and refused by a non-recursive delete.
        await mkdir(join(partialsDir, 'undeletable'));
        await ageStaging(TTL_MS * 2);

        const summary = await runPartialsOnce({ blob, ttlMs: TTL_MS });

        expect(summary).toEqual({ candidates: 2, reclaimed: 1, failed: 1, bytesFreed: 2000 });
        expect(await readdir(partialsDir)).toEqual([ 'undeletable' ]);
    });
});

//----------------------------------------------------------------------------------------------------------------------
