//----------------------------------------------------------------------------------------------------------------------
// Replace concurrency guard — the optional ifBlobID precondition on a content replace
//
// A replace may pin the blob the caller opened and edited from. When that ifBlobID no longer matches the target's
// current blob at commit time -- someone saved first -- the commit is refused with 409 and the node is left exactly as
// it was. Absent the guard, a replace is last-write-wins as before. Both commit transports (the ticket PUT and the
// proof-of-possession answer) honour it. Every expectation is derived from that contract, not from what the code
// returns; the node's untouched state on a 409 is asserted against the store, not just the status line.
//----------------------------------------------------------------------------------------------------------------------

import { createHash, randomBytes } from 'node:crypto';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { ClaimResponse, NodeResponse } from '@fileshed/core';

// Resource Access
import { NodeRA } from '@server/resource-access/nodes/node.ts';

// Support
import {
    type BootedBlobApp,
    type TestUser,
    answerReplace,
    blobRowCount,
    bootBlobApp,
    claim,
    computeAnswer,
    makeUser,
    nodeContentRow,
    putReplace,
    putUpload,
} from './support.ts';

//----------------------------------------------------------------------------------------------------------------------

function sha256Of(data : Buffer) : string
{
    return createHash('sha256')
        .update(data)
        .digest('hex');
}

// Just over 1 MiB: past the threshold where a known blob is proof-challenged rather than re-uploaded, so the replace
// travels the proof-of-possession transport with zero bytes moved.
function largeFixture() : Buffer
{
    return randomBytes((1024 * 1024) + 321);
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
// Helpers
//----------------------------------------------------------------------------------------------------------------------

// Upload bytes as a fresh file the caller owns, returning the committed file node.
async function uploadOwned(user : TestUser, bytes : Buffer, name = 'notes.txt', mimeType = 'text/plain')
: Promise<NodeResponse>
{
    const claimRes = await claim(booted.app, user.cookie, sha256Of(bytes), bytes.length);
    const claimBody = await claimRes.json() as ClaimResponse;
    if(claimBody.upload !== true) { throw new Error('setup: expected an upload ticket for a fresh blob'); }

    const res = await putUpload(booted.app, user.cookie, claimBody.ticket, bytes, { name, mimeType, parentID: null });
    if(res.status !== 200) { throw new Error(`setup: upload failed with ${ res.status }`); }

    return await res.json() as NodeResponse;
}

// Claim fresh replacement bytes (always a ticket -- fresh content) and commit them onto an existing file, optionally
// pinning the blob the edit started from.
async function replaceViaUpload(user : TestUser, bytes : Buffer, targetID : string, ifBlobID ?: string)
: Promise<Response>
{
    const claimRes = await claim(booted.app, user.cookie, sha256Of(bytes), bytes.length);
    const claimBody = await claimRes.json() as ClaimResponse;
    if(claimBody.upload !== true) { throw new Error('setup: expected an upload ticket for fresh replacement bytes'); }

    return putReplace(booted.app, user.cookie, claimBody.ticket, bytes, targetID, undefined, ifBlobID);
}

async function currentBlobID(nodeID : string) : Promise<string | null>
{
    return (await nodeContentRow(booted.handle, nodeID)).blob_id;
}

async function ownedBytesOf(userID : string) : Promise<number>
{
    return new NodeRA(booted.handle).ownedBytes(userID);
}

//----------------------------------------------------------------------------------------------------------------------
// The guard on the ticket-PUT transport.
//----------------------------------------------------------------------------------------------------------------------

describe('replace ifBlobID guard — ticket PUT', () =>
{
    it('commits the replace when the guard still matches the current blob', async () =>
    {
        const owner = await makeUser(booted, 'guard-match@example.com');
        const original = randomBytes(2048);
        const originalSha = sha256Of(original);
        const file = await uploadOwned(owner, original);

        const replacement = randomBytes(4096);
        const replacementSha = sha256Of(replacement);

        // The caller pins the blob it opened from, and nothing changed under it, so the replace goes through.
        const res = await replaceViaUpload(owner, replacement, file.id, originalSha);
        const node = await res.json() as NodeResponse;

        expect(res.status).toBe(200);
        if(node.type !== 'file') { throw new Error('expected a file node'); }
        expect(node.blobID).toBe(replacementSha);
        expect(await currentBlobID(file.id)).toBe(replacementSha);
    });

    it('refuses the replace with 409 when another save moved the blob on since the guard was taken', async () =>
    {
        const owner = await makeUser(booted, 'guard-stale@example.com', 100_000);
        const openedContent = randomBytes(2048);
        const openedSha = sha256Of(openedContent);
        const file = await uploadOwned(owner, openedContent);

        // Someone else saves first: a guardless replace moves the node to new content.
        const winner = randomBytes(4096);
        const winnerSha = sha256Of(winner);
        expect((await replaceViaUpload(owner, winner, file.id)).status).toBe(200);
        expect(await currentBlobID(file.id)).toBe(winnerSha);

        // The stale editor saves, still pinning the blob they opened -- which is no longer current.
        const stale = randomBytes(1024);
        const staleSha = sha256Of(stale);
        const res = await replaceViaUpload(owner, stale, file.id, openedSha);

        expect(res.status).toBe(409);

        // The node is untouched: still the winner's content, no record for the rejected bytes, usage unchanged.
        expect(await currentBlobID(file.id)).toBe(winnerSha);
        expect(await blobRowCount(booted.handle, staleSha)).toBe(0);
        expect(await ownedBytesOf(owner.id)).toBe(winner.length);
    });

    it('overwrites last-write-wins when no guard is supplied, even though the content differs', async () =>
    {
        const owner = await makeUser(booted, 'guard-absent@example.com');
        const file = await uploadOwned(owner, randomBytes(2048));

        const replacement = randomBytes(4096);
        const replacementSha = sha256Of(replacement);

        // No ifBlobID: the replace carries no precondition, so it always lands.
        const res = await replaceViaUpload(owner, replacement, file.id);

        expect(res.status).toBe(200);
        expect(await currentBlobID(file.id)).toBe(replacementSha);
    });
});

//----------------------------------------------------------------------------------------------------------------------
// The same guard on the proof-of-possession transport: a known blob, zero bytes moved.
//----------------------------------------------------------------------------------------------------------------------

describe('replace ifBlobID guard — proof of possession', () =>
{
    it('commits a proven replace when the guard still matches the current blob', async () =>
    {
        const owner = await makeUser(booted, 'pop-guard-match@example.com');

        // A large blob the owner already holds, so claiming it yields a challenge, not a ticket.
        const known = largeFixture();
        const knownSha = sha256Of(known);
        await uploadOwned(owner, known, 'held.bin', 'application/octet-stream');

        const original = randomBytes(2048);
        const originalSha = sha256Of(original);
        const file = await uploadOwned(owner, original, 'target.bin', 'application/octet-stream');

        const challengeRes = await claim(booted.app, owner.cookie, knownSha, known.length);
        const challenge = await challengeRes.json() as ClaimResponse;
        if(challenge.upload !== false) { throw new Error('expected a proof-of-possession challenge'); }

        const answer = computeAnswer(challenge.nonce, challenge.ranges, known);
        const res = await answerReplace(
            booted.app,
            owner.cookie,
            challenge.challengeID,
            answer,
            file.id,
            undefined,
            originalSha
        );
        const node = await res.json() as NodeResponse;

        expect(res.status).toBe(200);
        if(node.type !== 'file') { throw new Error('expected a file node'); }
        expect(node.blobID).toBe(knownSha);
        expect(await currentBlobID(file.id)).toBe(knownSha);
    });

    it('refuses a proven replace with 409 when the blob moved on since the guard was taken', async () =>
    {
        const owner = await makeUser(booted, 'pop-guard-stale@example.com');

        const known = largeFixture();
        const knownSha = sha256Of(known);
        await uploadOwned(owner, known, 'held.bin', 'application/octet-stream');

        const openedContent = randomBytes(2048);
        const openedSha = sha256Of(openedContent);
        const file = await uploadOwned(owner, openedContent, 'target.bin', 'application/octet-stream');

        // Someone else saves first, moving the node off the blob the guard names.
        const winner = randomBytes(4096);
        const winnerSha = sha256Of(winner);
        expect((await replaceViaUpload(owner, winner, file.id)).status).toBe(200);

        const challengeRes = await claim(booted.app, owner.cookie, knownSha, known.length);
        const challenge = await challengeRes.json() as ClaimResponse;
        if(challenge.upload !== false) { throw new Error('expected a proof-of-possession challenge'); }

        const answer = computeAnswer(challenge.nonce, challenge.ranges, known);
        const res = await answerReplace(
            booted.app,
            owner.cookie,
            challenge.challengeID,
            answer,
            file.id,
            undefined,
            openedSha
        );

        expect(res.status).toBe(409);

        // Untouched: still the winner's blob, and the known blob was NOT pointed at the target.
        expect(await currentBlobID(file.id)).toBe(winnerSha);
    });
});

//----------------------------------------------------------------------------------------------------------------------
