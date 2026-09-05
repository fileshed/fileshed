//----------------------------------------------------------------------------------------------------------------------
// Refused Writes — what a write that never happened may leave behind
//
// Bytes are published before the commit that records them, so every refusal inside that commit rolls back rows over
// bytes that are already on disk. The rule this drives is that such a write leaves nothing standing: no record, no
// node, no charge against the owner, and no bytes that nothing will ever reclaim. Refusals reachable without the bytes
// are held to the stronger form -- they must never publish at all.
//----------------------------------------------------------------------------------------------------------------------

import { createHash, randomBytes } from 'node:crypto';
import { stat, utimes } from 'node:fs/promises';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { type ClaimResponse, type NodeResponse, ORPHAN_GRACE_MS } from '@fileshed/core';

// Managers
import { runGcOnce } from '@server/managers/gc.ts';

// Support
import {
    type BootedBlobApp,
    blobRowCount,
    bootBlobApp,
    bytesExist,
    claim,
    fileNodesForBlob,
    makeUser,
    putReplace,
    putUpload,
    setQuotaLimit,
} from './support.ts';

//----------------------------------------------------------------------------------------------------------------------

// Long enough that nothing this spec stores is inside it by accident, and short enough that the sweep still has one.
const GRACE_MS = 7 * 24 * 60 * 60 * 1000;

let booted : BootedBlobApp;

beforeEach(async () =>
{
    booted = await bootBlobApp();
});

afterEach(async () =>
{
    await booted.cleanup();
});

//----------------------------------------------------------------------------------------------------------------------

function sha256Of(data : Buffer) : string
{
    return createHash('sha256')
        .update(data)
        .digest('hex');
}

// Bytes just written are inside the reconciler's window on purpose -- a record for them may still be committing. Push
// what the store holds for this address back past it, the way a real leak ages while nobody looks at it.
async function ageStoredBytes(sha256 : string) : Promise<void>
{
    const path = join(booted.storageRoot, sha256.slice(0, 2), sha256.slice(2, 4), sha256);
    const aged = new Date(Date.now() - ORPHAN_GRACE_MS - 60_000);

    if(await stat(path).catch(() => null) !== null) { await utimes(path, aged, aged); }
}

async function uploadFile(cookie : string, data : Buffer, name : string) : Promise<NodeResponse>
{
    const claimed = await (await claim(booted.app, cookie, sha256Of(data), data.length)).json() as ClaimResponse;
    if(claimed.upload !== true) { throw new Error('expected an upload ticket'); }

    const stored = await putUpload(booted.app, cookie, claimed.ticket, data, {
        name,
        parentID: null,
        mimeType: 'application/octet-stream',
    });

    return await stored.json() as NodeResponse;
}

//----------------------------------------------------------------------------------------------------------------------

describe('a write refused inside its commit', () =>
{
    // The quota re-judge is the last gate a write passes, and it runs where the bytes have already been published:
    // the ticket was admitted under a roomier cap than the one in force when the file lands.
    it('leaves no record, no node, and no bytes that outlive the sweep', async () =>
    {
        const user = await makeUser(booted, 'refused@example.com', 8192);
        const data = randomBytes(4096);
        const sha256 = sha256Of(data);

        const admitted = await (await claim(booted.app, user.cookie, sha256, data.length)).json() as ClaimResponse;
        if(admitted.upload !== true) { throw new Error('expected an upload ticket under the roomier limit'); }

        await setQuotaLimit(booted, user.id, 1024);
        const refused = await putUpload(booted.app, user.cookie, admitted.ticket, data);

        expect(refused.status).toBe(403);
        expect(await blobRowCount(booted.handle, sha256)).toBe(0);
        expect(await fileNodesForBlob(booted.handle, sha256)).toHaveLength(0);

        await ageStoredBytes(sha256);
        await runGcOnce({ blob: booted.blob, graceMs: async () => GRACE_MS });

        expect(await bytesExist(booted, sha256)).toBe(false);
    });

    // Round after round of this is what makes the leak serious: nothing charges an account for bytes no node points
    // at, so the refusals are unbounded even though each one is bounded by a quota.
    it('leaves nothing behind however many times it is refused', async () =>
    {
        const user = await makeUser(booted, 'looper@example.com', 8192);
        const rounds = [ randomBytes(4096), randomBytes(4097), randomBytes(4098) ];

        // Sequential rather than concurrent: each round claims under the roomy cap and then lands under the tight
        // one, which is the shape a client repeating a refused write actually has.
        async function refuseRound(remaining : Buffer[]) : Promise<void>
        {
            const [ data, ...rest ] = remaining;
            if(data === undefined) { return; }

            await setQuotaLimit(booted, user.id, 8192);
            const admitted = await (await claim(booted.app, user.cookie, sha256Of(data), data.length))
                .json() as ClaimResponse;
            if(admitted.upload !== true) { throw new Error('expected an upload ticket'); }

            await setQuotaLimit(booted, user.id, 1024);
            expect((await putUpload(booted.app, user.cookie, admitted.ticket, data)).status).toBe(403);
            await ageStoredBytes(sha256Of(data));

            return refuseRound(rest);
        }

        await refuseRound(rounds);
        await runGcOnce({ blob: booted.blob, graceMs: async () => GRACE_MS });

        const survivors = await Promise.all(rounds.map((data) => bytesExist(booted, sha256Of(data))));
        expect(survivors).toEqual([ false, false, false ]);
    });
});

//----------------------------------------------------------------------------------------------------------------------

describe('a write refused before its bytes', () =>
{
    // The stale-edit guard needs nothing from the upload to answer: the caller pinned a version, and the node either
    // still carries it or does not. Judging that only after the bytes have been published would store the content of
    // an edit that is being thrown away.
    it('publishes nothing when the caller pinned a version another write has already replaced', async () =>
    {
        const user = await makeUser(booted, 'stale@example.com');
        const original = randomBytes(2048);
        const node = await uploadFile(user.cookie, original, 'notes.txt');

        const replacement = randomBytes(3072);
        const replacementSha = sha256Of(replacement);

        const admitted = await (await claim(booted.app, user.cookie, replacementSha, replacement.length))
            .json() as ClaimResponse;
        if(admitted.upload !== true) { throw new Error('expected an upload ticket'); }

        const refused = await putReplace(
            booted.app,
            user.cookie,
            admitted.ticket,
            replacement,
            node.id,
            undefined,
            sha256Of(randomBytes(16))
        );

        expect(refused.status).toBe(409);
        expect(await bytesExist(booted, replacementSha)).toBe(false);
        expect(await blobRowCount(booted.handle, replacementSha)).toBe(0);
    });
});

//----------------------------------------------------------------------------------------------------------------------
