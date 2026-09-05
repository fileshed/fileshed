//----------------------------------------------------------------------------------------------------------------------
// Blob Claim / PoP / Upload Flow — end to end
//
// Drives the real routes -> BlobManager -> real fs store + in-memory database with app.request (zero mocks). Every
// expectation is derived from the claim/PoP/upload flow with its security rules and from quota admission, not from
// what the code happens to return. Proof answers are computed locally from the fixture bytes the way a possessing
// client would, and randomised challenge output is asserted structurally (count, bounds, presence) -- never against
// exact values.
//----------------------------------------------------------------------------------------------------------------------

import { createHash, randomBytes } from 'node:crypto';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ClaimResponse, NodeResponse } from '@fileshed/core';

// Resource Access
import { BlobRA } from '@server/resource-access/blob/index.ts';
import { NodeRA } from '@server/resource-access/nodes/node.ts';

// Support
import {
    type BootedBlobApp,
    answerChallenge,
    blobRowCount,
    bootBlobApp,
    bytesExist,
    claim,
    computeAnswer,
    fileNodesForBlob,
    makeUser,
    putUpload,
    setQuotaLimit,
    storedBytes,
} from './support.ts';
import { folderNode } from '../resource-access/nodes/support.ts';

//----------------------------------------------------------------------------------------------------------------------

function sha256Of(data : Buffer) : string
{
    return createHash('sha256')
        .update(data)
        .digest('hex');
}

// Just over 1 MiB -- the threshold above which a known blob is challenged rather than re-uploaded.
function largeFixture() : Buffer
{
    return randomBytes((1024 * 1024) + 777);
}

//----------------------------------------------------------------------------------------------------------------------

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
// A fresh upload: A uploads a blob nobody holds yet and receives a ticket, then streams the bytes.
//----------------------------------------------------------------------------------------------------------------------

describe('POST /api/blobs/claim + PUT /api/uploads/:ticket', () =>
{
    it('stores the blob, creates the owner file node, and charges the owner on a fresh upload', async () =>
    {
        const user = await makeUser(booted, 'fresh@example.com');
        const data = randomBytes(4096);
        const sha256 = sha256Of(data);

        const claimRes = await claim(booted.app, user.cookie, sha256, data.length);
        const claimBody = await claimRes.json() as ClaimResponse;

        expect(claimRes.status).toBe(200);
        expect(claimBody.upload).toBe(true);
        if(claimBody.upload !== true) { throw new Error('expected an upload ticket'); }

        const putRes = await putUpload(booted.app, user.cookie, claimBody.ticket, data);
        const node = await putRes.json() as NodeResponse;

        expect(putRes.status).toBe(200);
        expect(node.type).toBe('file');
        expect(node.ownerID).toBe(user.id);

        expect(await blobRowCount(booted.handle, sha256)).toBe(1);
        const owners = (await fileNodesForBlob(booted.handle, sha256)).map((row) => row.owner_id);
        expect(owners).toEqual([ user.id ]);

        expect(await storedBytes(booted, sha256)).toEqual(data);
        expect(await new NodeRA(booted.handle).ownedBytes(user.id)).toBe(data.length);
    });

    it('creates an empty file end to end when the claim declares zero bytes', async () =>
    {
        const user = await makeUser(booted, 'empty@example.com');
        const empty = Buffer.alloc(0);
        const sha256 = sha256Of(empty);

        const claimRes = await claim(booted.app, user.cookie, sha256, 0);
        const claimBody = await claimRes.json() as ClaimResponse;

        expect(claimRes.status).toBe(200);
        if(claimBody.upload !== true) { throw new Error('expected an upload ticket'); }

        const putRes = await putUpload(booted.app, user.cookie, claimBody.ticket, empty);
        const node = await putRes.json() as NodeResponse;

        expect(putRes.status).toBe(200);
        if(node.type !== 'file') { throw new Error('expected a file node'); }
        expect(node.size).toBe(0);

        expect(await blobRowCount(booted.handle, sha256)).toBe(1);
        expect(await storedBytes(booted, sha256)).toEqual(empty);
        expect(await new NodeRA(booted.handle).ownedBytes(user.id)).toBe(0);
    });

    it('rejects a lying upload whose bytes do not match the claimed hash, storing nothing', async () =>
    {
        const user = await makeUser(booted, 'liar@example.com');
        const honest = randomBytes(2048);
        const sha256 = sha256Of(honest);
        const forged = randomBytes(honest.length);

        const claimBody = await (await claim(booted.app, user.cookie, sha256, honest.length)).json() as ClaimResponse;
        if(claimBody.upload !== true) { throw new Error('expected an upload ticket'); }

        const putRes = await putUpload(booted.app, user.cookie, claimBody.ticket, forged);

        expect(putRes.status).toBe(400);
        expect(await blobRowCount(booted.handle, sha256)).toBe(0);
        expect(await fileNodesForBlob(booted.handle, sha256)).toHaveLength(0);
        expect(await bytesExist(booted, sha256)).toBe(false);

        // The store cleans its staging file on a rejected put -- a lying client leaves no orphan bytes.
        const staged = await readdir(join(booted.storageRoot, '.staging')).catch(() => []);
        expect(staged).toHaveLength(0);
    });

    it('treats a body short of the claimed size as the first chunk, committing nothing yet', async () =>
    {
        const user = await makeUser(booted, 'mismatch@example.com');
        const data = randomBytes(2048);
        const sha256 = sha256Of(data);

        // Claim ten more bytes than the body carries. Bytes arriving at the start of a file that is not yet whole are
        // the opening chunk of an upload, whatever the client meant by them -- so they are held, not committed.
        const claimBody = await (await claim(booted.app, user.cookie, sha256, data.length + 10))
            .json() as ClaimResponse;
        if(claimBody.upload !== true) { throw new Error('expected an upload ticket'); }

        const putRes = await putUpload(booted.app, user.cookie, claimBody.ticket, data);

        expect(putRes.status).toBe(202);
        expect(await blobRowCount(booted.handle, sha256)).toBe(0);
        expect(await fileNodesForBlob(booted.handle, sha256)).toHaveLength(0);
    });

    it('places the uploaded file under a parent folder the caller owns', async () =>
    {
        const user = await makeUser(booted, 'parent-own@example.com');
        await new NodeRA(booted.handle).insert(folderNode({ id: 'folder-own', ownerID: user.id }));
        const data = randomBytes(2048);

        const claimBody = await (await claim(booted.app, user.cookie, sha256Of(data), data.length))
            .json() as ClaimResponse;
        if(claimBody.upload !== true) { throw new Error('expected an upload ticket'); }

        const putRes = await putUpload(booted.app, user.cookie, claimBody.ticket, data, {
            name: 'nested.bin',
            parentID: 'folder-own',
            mimeType: 'application/octet-stream',
        });
        const node = await putRes.json() as NodeResponse;

        expect(putRes.status).toBe(200);
        expect(node.parentID).toBe('folder-own');
    });

    it('refuses an upload into a parent folder owned by someone else, storing nothing', async () =>
    {
        const owner = await makeUser(booted, 'folder-owner@example.com');
        const uploader = await makeUser(booted, 'uploader@example.com');
        await new NodeRA(booted.handle).insert(folderNode({ id: 'folder-foreign', ownerID: owner.id }));
        const data = randomBytes(2048);

        const claimBody = await (await claim(booted.app, uploader.cookie, sha256Of(data), data.length))
            .json() as ClaimResponse;
        if(claimBody.upload !== true) { throw new Error('expected an upload ticket'); }

        const putRes = await putUpload(booted.app, uploader.cookie, claimBody.ticket, data, {
            name: 'nested.bin',
            parentID: 'folder-foreign',
            mimeType: 'application/octet-stream',
        });

        expect(putRes.status).toBe(403);
        expect(await blobRowCount(booted.handle, sha256Of(data))).toBe(0);
    });

    it('refuses an upload into a trashed parent folder, storing nothing', async () =>
    {
        const user = await makeUser(booted, 'trashed-parent@example.com');
        await new NodeRA(booted.handle).insert(
            folderNode({ id: 'folder-trashed', ownerID: user.id, trashedAt: new Date() })
        );
        const data = randomBytes(2048);

        const claimBody = await (await claim(booted.app, user.cookie, sha256Of(data), data.length))
            .json() as ClaimResponse;
        if(claimBody.upload !== true) { throw new Error('expected an upload ticket'); }

        const putRes = await putUpload(booted.app, user.cookie, claimBody.ticket, data, {
            name: 'nested.bin',
            parentID: 'folder-trashed',
            mimeType: 'application/octet-stream',
        });

        // A trashed parent is a legal-request-but-illegal-state rejection (parent.trashed -> 422), the gap the shared
        // regulation judge closes on this path.
        expect(putRes.status).toBe(422);
        expect(await blobRowCount(booted.handle, sha256Of(data))).toBe(0);
    });

    it('refuses a ticket used by a different user than claimed it', async () =>
    {
        const owner = await makeUser(booted, 'owner@example.com');
        const intruder = await makeUser(booted, 'intruder@example.com');
        const data = randomBytes(2048);

        const claimBody = await (await claim(booted.app, owner.cookie, sha256Of(data), data.length))
            .json() as ClaimResponse;
        if(claimBody.upload !== true) { throw new Error('expected an upload ticket'); }

        const putRes = await putUpload(booted.app, intruder.cookie, claimBody.ticket, data);

        expect(putRes.status).toBe(403);
        expect(await blobRowCount(booted.handle, sha256Of(data))).toBe(0);
    });
});

//----------------------------------------------------------------------------------------------------------------------
// Deduplication: a second user claiming a blob that already exists proves possession instead of re-uploading.
//----------------------------------------------------------------------------------------------------------------------

describe('proof-of-possession dedup', () =>
{
    async function seedLargeBlob(email : string) : Promise<{ data : Buffer; sha256 : string; ownerID : string }>
    {
        const uploader = await makeUser(booted, email);
        const data = largeFixture();
        const sha256 = sha256Of(data);

        const claimBody = await (await claim(booted.app, uploader.cookie, sha256, data.length)).json() as ClaimResponse;
        if(claimBody.upload !== true) { throw new Error('expected an upload ticket'); }
        await putUpload(booted.app, uploader.cookie, claimBody.ticket, data);

        return { data, sha256, ownerID: uploader.id };
    }

    it('challenges a known large blob with 2-4 in-bounds random ranges and a nonce', async () =>
    {
        const { data, sha256 } = await seedLargeBlob('seed-a@example.com');
        const other = await makeUser(booted, 'claimant-a@example.com');

        const body = await (await claim(booted.app, other.cookie, sha256, data.length)).json() as ClaimResponse;

        expect(body.upload).toBe(false);
        if(body.upload !== false) { throw new Error('expected a challenge'); }

        expect(body.challengeID.length).toBeGreaterThan(0);
        expect(body.nonce.length).toBeGreaterThan(0);
        expect(body.ranges.length).toBeGreaterThanOrEqual(2);
        expect(body.ranges.length).toBeLessThanOrEqual(4);

        for(const [ offset, length ] of body.ranges)
        {
            expect(offset).toBeGreaterThanOrEqual(0);
            expect(length).toBeGreaterThanOrEqual(1);
            expect(offset + length).toBeLessThanOrEqual(data.length);
        }
    });

    it('issues distinct challenges on repeat claims', async () =>
    {
        const { data, sha256 } = await seedLargeBlob('seed-b@example.com');
        const other = await makeUser(booted, 'claimant-b@example.com');

        const first = await (await claim(booted.app, other.cookie, sha256, data.length)).json() as ClaimResponse;
        const second = await (await claim(booted.app, other.cookie, sha256, data.length)).json() as ClaimResponse;
        if(first.upload !== false || second.upload !== false) { throw new Error('expected challenges'); }

        expect(first.challengeID).not.toBe(second.challengeID);
        expect(first.nonce).not.toBe(second.nonce);
    });

    it('creates a deduped node on a correct proof, moving zero bytes', async () =>
    {
        const { data, sha256, ownerID } = await seedLargeBlob('seed-c@example.com');
        const claimant = await makeUser(booted, 'claimant-c@example.com');

        const challenge = await (await claim(booted.app, claimant.cookie, sha256, data.length)).json() as ClaimResponse;
        if(challenge.upload !== false) { throw new Error('expected a challenge'); }

        const answer = computeAnswer(challenge.nonce, challenge.ranges, data);
        const res = await answerChallenge(booted.app, claimant.cookie, challenge.challengeID, answer);
        const node = await res.json() as NodeResponse;

        expect(res.status).toBe(200);
        expect(node.ownerID).toBe(claimant.id);

        // Still one blob record, now referenced by both users; the claimant is charged despite uploading nothing.
        expect(await blobRowCount(booted.handle, sha256)).toBe(1);
        const owners = (await fileNodesForBlob(booted.handle, sha256)).map((row) => row.owner_id).sort();
        expect(owners).toEqual([ ownerID, claimant.id ].sort());
        expect(await new NodeRA(booted.handle).ownedBytes(claimant.id)).toBe(data.length);
    });

    it('rejects a wrong proof with 403 and creates no node', async () =>
    {
        const { data, sha256 } = await seedLargeBlob('seed-d@example.com');
        const claimant = await makeUser(booted, 'claimant-d@example.com');

        const challenge = await (await claim(booted.app, claimant.cookie, sha256, data.length)).json() as ClaimResponse;
        if(challenge.upload !== false) { throw new Error('expected a challenge'); }

        const res = await answerChallenge(booted.app, claimant.cookie, challenge.challengeID, '0'.repeat(64));

        expect(res.status).toBe(403);
        const owners = (await fileNodesForBlob(booted.handle, sha256)).map((row) => row.owner_id);
        expect(owners).not.toContain(claimant.id);
    });

    it('treats a challenge as single-use: a replay is gone', async () =>
    {
        const { data, sha256 } = await seedLargeBlob('seed-e@example.com');
        const claimant = await makeUser(booted, 'claimant-e@example.com');

        const challenge = await (await claim(booted.app, claimant.cookie, sha256, data.length)).json() as ClaimResponse;
        if(challenge.upload !== false) { throw new Error('expected a challenge'); }
        const answer = computeAnswer(challenge.nonce, challenge.ranges, data);

        const first = await answerChallenge(booted.app, claimant.cookie, challenge.challengeID, answer);
        const replay = await answerChallenge(booted.app, claimant.cookie, challenge.challengeID, answer);

        expect(first.status).toBe(200);
        expect(replay.status).toBe(404);
    });

    it('drops a challenge once its TTL has elapsed', async () =>
    {
        const { data, sha256 } = await seedLargeBlob('seed-f@example.com');
        const claimant = await makeUser(booted, 'claimant-f@example.com');

        vi.useFakeTimers({ toFake: [ 'Date' ] });
        try
        {
            const challenge = await (await claim(booted.app, claimant.cookie, sha256, data.length))
                .json() as ClaimResponse;
            if(challenge.upload !== false) { throw new Error('expected a challenge'); }

            // Challenges live 60s. Jump just past that; the session cookie (minted before, ~5 min) is still
            // valid, so only the challenge has expired.
            vi.setSystemTime(new Date(Date.now() + 61_000));
            const answer = computeAnswer(challenge.nonce, challenge.ranges, data);
            const res = await answerChallenge(booted.app, claimant.cookie, challenge.challengeID, answer);

            expect(res.status).toBe(404);
        }
        finally
        {
            vi.useRealTimers();
        }
    });

    it('skips the challenge for a known small blob, issuing an upload ticket instead', async () =>
    {
        const uploader = await makeUser(booted, 'small-up@example.com');
        const data = randomBytes(2048);
        const sha256 = sha256Of(data);

        const first = await (await claim(booted.app, uploader.cookie, sha256, data.length)).json() as ClaimResponse;
        if(first.upload !== true) { throw new Error('expected an upload ticket'); }
        await putUpload(booted.app, uploader.cookie, first.ticket, data);

        const claimant = await makeUser(booted, 'small-claim@example.com');
        const second = await (await claim(booted.app, claimant.cookie, sha256, data.length)).json() as ClaimResponse;

        expect(second.upload).toBe(true);
    });
});

//----------------------------------------------------------------------------------------------------------------------
// Quota admission at claim time.
//----------------------------------------------------------------------------------------------------------------------

describe('quota admission', () =>
{
    it('rejects a claim that would exceed the owner quota with 403', async () =>
    {
        const user = await makeUser(booted, 'capped@example.com', 4096);
        const data = randomBytes(2048);

        const res = await claim(booted.app, user.cookie, sha256Of(data), 4097);
        const body = await res.json() as { error : string };

        expect(res.status).toBe(403);
        expect(body.error.toLowerCase()).toContain('quota');
    });

    // A ticket is not a promise: the cap it was admitted under can move while the bytes are still travelling, and the
    // limit in force when the write lands is the one that decides it. The re-check inside the commit transaction is
    // what makes that true, and it is the last gate a write passes -- so nothing may be recorded when it refuses.
    it('refuses an upload whose owner quota was lowered after the ticket was issued', async () =>
    {
        const user = await makeUser(booted, 'lowered@example.com', 8192);
        const data = randomBytes(4096);
        const sha256 = sha256Of(data);

        const admitted = await (await claim(booted.app, user.cookie, sha256, data.length)).json() as ClaimResponse;
        if(admitted.upload !== true) { throw new Error('expected an upload ticket under the roomier limit'); }

        await setQuotaLimit(booted, user.id, 1024);
        const upload = await putUpload(booted.app, user.cookie, admitted.ticket, data);

        expect(upload.status).toBe(403);
        expect(await fileNodesForBlob(booted.handle, sha256)).toHaveLength(0);
        expect(await blobRowCount(booted.handle, sha256)).toBe(0);
    });

    it('admits a claim exactly at the quota limit', async () =>
    {
        const user = await makeUser(booted, 'exact@example.com', 4096);
        const data = randomBytes(4096);

        const res = await claim(booted.app, user.cookie, sha256Of(data), 4096);
        const body = await res.json() as ClaimResponse;

        expect(res.status).toBe(200);
        expect(body.upload).toBe(true);
    });
});

//----------------------------------------------------------------------------------------------------------------------
// A claim naming a hash the instance holds, at a size it does not.
//----------------------------------------------------------------------------------------------------------------------

describe('claims at a size the stored blob disagrees with', () =>
{
    const known = randomBytes(4096);
    const knownSha = sha256Of(known);

    // Somebody else's file, already on the instance -- what a stranger naming its hash is fishing for.
    async function seedKnownBlob() : Promise<void>
    {
        const owner = await makeUser(booted, 'owner-of-known@example.com', null);
        const claimed = await (await claim(booted.app, owner.cookie, knownSha, known.length)).json() as ClaimResponse;
        if(claimed.upload !== true) { throw new Error('expected an upload ticket for new content'); }

        await putUpload(booted.app, owner.cookie, claimed.ticket, known);
    }

    // A content-addressed store admits no size disagreement: same sha means same bytes means same size. But a claim
    // at the wrong size does not describe what this instance holds, and answering it any differently from content the
    // instance does not hold would confirm the hash to anyone who names one -- in a single request, without having to
    // know the size. So the two are answered alike, and the lie is left to die at the bytes.
    it('answers a known-blob claim at the wrong size exactly as it answers content it does not hold', async () =>
    {
        await seedKnownBlob();

        const stranger = await makeUser(booted, 'stranger@example.com', null);
        const guess = await claim(booted.app, stranger.cookie, knownSha, 16);
        const unknown = await claim(booted.app, stranger.cookie, sha256Of(randomBytes(16)), 16);

        expect(guess.status).toBe(200);
        expect(guess.status).toBe(unknown.status);
        expect((await guess.json() as ClaimResponse).upload)
            .toBe((await unknown.json() as ClaimResponse).upload);
    });

    // Where the lie is caught: the ticket admits only the size that was claimed, and the store checks the bytes
    // against the address they claim to be. So a caller who does not possess the content gets an upload that cannot
    // commit -- and the blob everyone else is using is not touched on the way past.
    it('commits nothing for a claim at the wrong size, leaving the stored blob whole', async () =>
    {
        await seedKnownBlob();

        const liar = await makeUser(booted, 'liar@example.com', null);
        const lie = await (await claim(booted.app, liar.cookie, knownSha, 16)).json() as ClaimResponse;
        if(lie.upload !== true) { throw new Error('expected an upload ticket'); }

        const delivered = await putUpload(booted.app, liar.cookie, lie.ticket, randomBytes(16));

        expect(delivered.status).toBe(400);
        expect(await blobRowCount(booted.handle, knownSha)).toBe(1);
        expect(await storedBytes(booted, knownSha)).toEqual(known);
        expect(await fileNodesForBlob(booted.handle, knownSha)).toHaveLength(1);
    });
});

//----------------------------------------------------------------------------------------------------------------------

//----------------------------------------------------------------------------------------------------------------------
// Graveyard resurrection through the claim path.
//----------------------------------------------------------------------------------------------------------------------

describe('graveyard resurrection', () =>
{
    it('resurrects a graveyarded blob on a successful proof of possession', async () =>
    {
        const uploader = await makeUser(booted, 'grave-up@example.com');
        const data = largeFixture();
        const sha256 = sha256Of(data);

        const claimBody = await (await claim(booted.app, uploader.cookie, sha256, data.length)).json() as ClaimResponse;
        if(claimBody.upload !== true) { throw new Error('expected an upload ticket'); }
        await putUpload(booted.app, uploader.cookie, claimBody.ticket, data);

        // Drop the only reference and graveyard the now-unreferenced blob, as the node purge path would.
        const [ node ] = await fileNodesForBlob(booted.handle, sha256);
        await booted.handle.db.deleteFrom('node').where('id', '=', node.id)
            .execute();
        const blob = new BlobRA(booted.handle);
        await blob.graveyardUnreferenced([ sha256 ]);
        expect((await blob.get(sha256))?.deletedAt).not.toBeNull();

        const claimant = await makeUser(booted, 'grave-claim@example.com');
        const challenge = await (await claim(booted.app, claimant.cookie, sha256, data.length)).json() as ClaimResponse;
        if(challenge.upload !== false) { throw new Error('expected a challenge'); }

        const answer = computeAnswer(challenge.nonce, challenge.ranges, data);
        const res = await answerChallenge(booted.app, claimant.cookie, challenge.challengeID, answer);

        expect(res.status).toBe(200);
        expect((await blob.get(sha256))?.deletedAt).toBeNull();
    });
});

//----------------------------------------------------------------------------------------------------------------------
// Failed-proof rate limiting.
//----------------------------------------------------------------------------------------------------------------------

describe('failed-proof rate limiting', () =>
{
    it('returns 429 once a user exceeds the failed-proof threshold', async () =>
    {
        const uploader = await makeUser(booted, 'rl-up@example.com');
        const data = largeFixture();
        const sha256 = sha256Of(data);
        const claimBody = await (await claim(booted.app, uploader.cookie, sha256, data.length)).json() as ClaimResponse;
        if(claimBody.upload !== true) { throw new Error('expected an upload ticket'); }
        await putUpload(booted.app, uploader.cookie, claimBody.ticket, data);

        const prober = await makeUser(booted, 'prober@example.com');

        async function failOnce() : Promise<number>
        {
            const claimed = await claim(booted.app, prober.cookie, sha256, data.length);
            const challenge = await claimed.json() as ClaimResponse;
            if(challenge.upload !== false) { throw new Error('expected a challenge'); }
            const res = await answerChallenge(booted.app, prober.cookie, challenge.challengeID, '0'.repeat(64));
            return res.status;
        }

        // The threshold is a chosen design value (MAX_FAILED_PROOFS in blob.ts); keep failing until the limiter trips,
        // asserting every pre-limit answer is a 403 and the tripping one is a 429 -- never a silent pass. Recursion
        // rather than a loop keeps the sequential awaits (each depends on the accumulated failure count) lint-clean.
        async function failUntilLimited(attemptsLeft : number) : Promise<boolean>
        {
            if(attemptsLeft === 0) { return false; }

            const status = await failOnce();
            if(status === 429) { return true; }

            expect(status).toBe(403);
            return failUntilLimited(attemptsLeft - 1);
        }

        expect(await failUntilLimited(25)).toBe(true);
    });
});

//----------------------------------------------------------------------------------------------------------------------
