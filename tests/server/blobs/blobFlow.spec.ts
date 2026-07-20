//----------------------------------------------------------------------------------------------------------------------
// Blob Claim / PoP / Upload Flow — end to end
//
// Drives the real routes -> BlobManager -> real fs store + in-memory database with app.request (zero mocks). Every
// expectation is derived from requirements.md sec 4.3 (the claim/PoP/upload flow and its security rules) and sec 5
// (quota admission), not from what the code happens to return. Proof answers are computed locally from the fixture
// bytes the way a possessing client would, and randomised challenge output is asserted structurally (count, bounds,
// presence) -- never against exact values.
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

// Just over 1 MiB -- the sec 4.3 threshold above which a known blob is challenged rather than re-uploaded.
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

        // The store cleans its staging file on a rejected put -- a lying client leaves no orphan bytes (sec 4.3).
        const staged = await readdir(join(booted.storageRoot, '.staging')).catch(() => []);
        expect(staged).toHaveLength(0);
    });

    it('rejects an upload whose Content-Length contradicts the claimed size', async () =>
    {
        const user = await makeUser(booted, 'mismatch@example.com');
        const data = randomBytes(2048);

        // Claim ten more bytes than the body carries: the declared Content-Length disagrees with the claim up front.
        const claimBody = await (await claim(booted.app, user.cookie, sha256Of(data), data.length + 10))
            .json() as ClaimResponse;
        if(claimBody.upload !== true) { throw new Error('expected an upload ticket'); }

        const putRes = await putUpload(booted.app, user.cookie, claimBody.ticket, data);

        expect(putRes.status).toBe(400);
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

            // sec 4.3: challenges live 60s. Jump just past that; the session cookie (minted before, ~5 min) is still
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
// Quota admission at claim time (sec 5).
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

    // A content-addressed store admits no size disagreement: same sha means same bytes means same size, so a claim
    // for a known blob at any other size is a lying client -- and admitting the lie would let a small claimed size
    // pass quota admission for a large real blob (sec 4.3 / sec 5).
    it('rejects a known-blob claim whose size disagrees with the stored blob', async () =>
    {
        const owner = await makeUser(booted, 'owner-of-known@example.com', null);
        const data = randomBytes(4096);
        const sha = sha256Of(data);

        const claimed = await claim(booted.app, owner.cookie, sha, 4096);
        const claimBody = await claimed.json() as { ticket : string };
        await putUpload(booted.app, owner.cookie, claimBody.ticket, data);

        const liar = await makeUser(booted, 'liar@example.com', null);
        const lie = await claim(booted.app, liar.cookie, sha, 16);

        expect(lie.status).toBe(400);
    });

    // The claim-time gate admits each claim in isolation, so a batch of claims can jointly overshoot -- the
    // authoritative re-check inside the commit transaction is what actually holds the sec 5 line.
    it('rejects the second commit of a batch whose claims jointly overshoot the quota', async () =>
    {
        const user = await makeUser(booted, 'batcher@example.com', 4096);
        const first = randomBytes(4096);
        const second = randomBytes(4096);

        const claimOne = await (await claim(booted.app, user.cookie, sha256Of(first), 4096)).json() as
            { ticket : string };
        const claimTwo = await (await claim(booted.app, user.cookie, sha256Of(second), 4096)).json() as
            { ticket : string };

        const uploadOne = await putUpload(booted.app, user.cookie, claimOne.ticket, first);
        const uploadTwo = await putUpload(booted.app, user.cookie, claimTwo.ticket, second);

        expect(uploadOne.status).toBe(200);
        expect(uploadTwo.status).toBe(403);
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
// Graveyard resurrection through the claim path (sec 4.2).
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
// Failed-proof rate limiting (sec 4.3).
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
