//----------------------------------------------------------------------------------------------------------------------
// Skipped Upload Names — the server's half of the filter
//
// The browser drops these files before it hashes a byte, which is where the feature is felt; this is where it is
// enforced. A claim carries a hash and a size and no name at all, so the commit is the first point the server sees a
// name and the last point before it becomes a node -- both the commit that carries the bytes and the deduped commit
// that carries none.
//----------------------------------------------------------------------------------------------------------------------

import { createHash, randomBytes } from 'node:crypto';

import { afterEach, describe, expect, it } from 'vitest';

import type { ClaimResponse } from '@fileshed/core';

// Support
import {
    type BootedBlobApp,
    answerChallenge,
    bootBlobApp,
    claim,
    computeAnswer,
    fileNodesForBlob,
    makeUser,
    putUpload,
} from './support.ts';

//----------------------------------------------------------------------------------------------------------------------

let booted : BootedBlobApp;

function sha256Of(data : Buffer) : string
{
    return createHash('sha256')
        .update(data)
        .digest('hex');
}

// Above SMALL_FILE_THRESHOLD_BYTES, so a second claim on the same hash is worth a proof-of-possession round trip
// rather than another upload -- which is the only way to reach the deduped commit.
function largeFixture() : Buffer
{
    return randomBytes((1024 * 1024) + 777);
}

async function nodeCount(sha256 : string) : Promise<number>
{
    return (await fileNodesForBlob(booted.handle, sha256)).length;
}

//----------------------------------------------------------------------------------------------------------------------

afterEach(async () =>
{
    await booted.cleanup();
});

//----------------------------------------------------------------------------------------------------------------------

describe('an upload commit naming a skipped file', () =>
{
    it('refuses it and stores no node', async () =>
    {
        booted = await bootBlobApp();
        const user = await makeUser(booted, 'ds-store@example.com');

        const data = randomBytes(64);
        const sha256 = sha256Of(data);
        const claimed = await claim(booted.app, user.cookie, sha256, data.length).then((res) => res.json()) as
            ClaimResponse;
        if(claimed.upload !== true) { throw new Error('expected an upload ticket'); }

        const res = await putUpload(booted.app, user.cookie, claimed.ticket, data, {
            name: '.DS_Store',
            parentID: null,
            mimeType: 'application/octet-stream',
        });

        expect(res.status).toBe(400);
        expect(await nodeCount(sha256)).toBe(0);
    });

    // The wildcard has to reach the server too: the sidecar names a Mac writes are per-file, so the list can only ever
    // name the pattern.
    it('refuses a name matching a wildcard pattern', async () =>
    {
        booted = await bootBlobApp();
        const user = await makeUser(booted, 'sidecar@example.com');

        const data = randomBytes(64);
        const sha256 = sha256Of(data);
        const claimed = await claim(booted.app, user.cookie, sha256, data.length).then((res) => res.json()) as
            ClaimResponse;
        if(claimed.upload !== true) { throw new Error('expected an upload ticket'); }

        const res = await putUpload(booted.app, user.cookie, claimed.ticket, data, {
            name: '._quarterly.pdf',
            parentID: null,
            mimeType: 'application/pdf',
        });

        expect(res.status).toBe(400);
        expect(await nodeCount(sha256)).toBe(0);
    });

    // The list is a setting an admin edits, so the answer has to come from the setting as it stands at the commit and
    // not from anything read at boot.
    it('judges the name against the list in force at that moment', async () =>
    {
        let skipped : string[] = [];
        booted = await bootBlobApp({ skippedUploadNames: async () => skipped });
        const user = await makeUser(booted, 'newly-banned@example.com');

        const metadata = { name: 'notes.tmp', parentID: null, mimeType: 'text/plain' };

        const first = randomBytes(64);
        const firstClaim = await claim(booted.app, user.cookie, sha256Of(first), first.length)
            .then((res) => res.json()) as ClaimResponse;
        if(firstClaim.upload !== true) { throw new Error('expected an upload ticket'); }

        expect((await putUpload(booted.app, user.cookie, firstClaim.ticket, first, metadata)).status).toBe(200);

        skipped = [ '*.tmp' ];

        const second = randomBytes(64);
        const secondClaim = await claim(booted.app, user.cookie, sha256Of(second), second.length)
            .then((res) => res.json()) as ClaimResponse;
        if(secondClaim.upload !== true) { throw new Error('expected an upload ticket'); }

        const res = await putUpload(booted.app, user.cookie, secondClaim.ticket, second, metadata);

        expect(res.status).toBe(400);
        expect(await nodeCount(sha256Of(second))).toBe(0);
    });
});

//----------------------------------------------------------------------------------------------------------------------

describe('a deduped commit naming a skipped file', () =>
{
    // Dedup is the way into the store that moves no bytes: the blob is already there, so nothing but the name check
    // stands between a proof of possession and a node called .DS_Store.
    it('refuses it and leaves the blob with only the node that uploaded it', async () =>
    {
        booted = await bootBlobApp();

        const uploader = await makeUser(booted, 'dedup-seed@example.com');
        const data = largeFixture();
        const sha256 = sha256Of(data);

        const seedClaim = await claim(booted.app, uploader.cookie, sha256, data.length)
            .then((res) => res.json()) as ClaimResponse;
        if(seedClaim.upload !== true) { throw new Error('expected an upload ticket'); }
        await putUpload(booted.app, uploader.cookie, seedClaim.ticket, data);

        const claimant = await makeUser(booted, 'dedup-claimant@example.com');
        const challenge = await claim(booted.app, claimant.cookie, sha256, data.length)
            .then((res) => res.json()) as ClaimResponse;
        if(challenge.upload !== false) { throw new Error('expected a challenge'); }

        const answer = computeAnswer(challenge.nonce, challenge.ranges, data);
        const res = await answerChallenge(booted.app, claimant.cookie, challenge.challengeID, answer, {
            name: 'Thumbs.db',
            parentID: null,
            mimeType: 'application/octet-stream',
        });

        expect(res.status).toBe(400);
        expect(await nodeCount(sha256)).toBe(1);
    });
});

//----------------------------------------------------------------------------------------------------------------------
