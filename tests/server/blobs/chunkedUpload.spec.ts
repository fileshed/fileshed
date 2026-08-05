//----------------------------------------------------------------------------------------------------------------------
// Chunked Upload Flow
//
// The upload arriving as a sequence of requests, driven through the real routes and manager against a real store. The
// contract being asserted: chunks are sequential and the ticket carries the position between them; nothing is committed
// until the last byte lands; a client and server that disagree about where the upload stands are told so rather than
// corrupting the file; and the assembled bytes face exactly the integrity check a single-stream upload faces.
//----------------------------------------------------------------------------------------------------------------------

import { createHash, randomBytes } from 'node:crypto';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
    type ClaimResponse,
    DEFAULT_UPLOAD_CHUNK_BYTES,
    type NodeResponse,
    type UploadChunkAccepted,
} from '@fileshed/core';

// Support
import {
    type BootedBlobApp,
    ORIGIN,
    type TestUser,
    blobRowCount,
    bootBlobApp,
    bytesExist,
    claim,
    fileNodesForBlob,
    makeUser,
    nodeContentRow,
    putChunk,
    putChunkReplace,
    putUpload,
    storedBytes,
} from './support.ts';

//----------------------------------------------------------------------------------------------------------------------

let booted : BootedBlobApp;

function sha256Of(data : Buffer) : string
{
    return createHash('sha256')
        .update(data)
        .digest('hex');
}

// A ticket for content the store has never seen, which is what an unknown blob's claim always answers with.
async function ticketResponseFor(user : TestUser, data : Buffer) : Promise<{ ticket : string; chunkBytes : number }>
{
    const body = await (await claim(booted.app, user.cookie, sha256Of(data), data.length)).json() as ClaimResponse;
    if(body.upload !== true) { throw new Error('expected an upload ticket for an unknown blob'); }

    return { ticket: body.ticket, chunkBytes: body.chunkBytes };
}

async function ticketFor(user : TestUser, data : Buffer) : Promise<string>
{
    return (await ticketResponseFor(user, data)).ticket;
}

// Cut a file the way a client does: contiguous chunks of the size the claim reported, the last one holding whatever
// is left. Deliberately the arithmetic and not the client's planner -- this spec proves the server's number is usable
// as given, not that two of our own modules agree.
function chunkRanges(totalBytes : number, chunkBytes : number) : [ number, number ][]
{
    const ranges : [ number, number ][] = [];
    for(let offset = 0; offset < totalBytes; offset += chunkBytes)
    {
        ranges.push([ offset, Math.min(chunkBytes, totalBytes - offset) ]);
    }

    return ranges;
}

async function partials() : Promise<string[]>
{
    return readdir(join(booted.storageRoot, '.partials')).catch(() => []);
}

//----------------------------------------------------------------------------------------------------------------------

beforeEach(async () =>
{
    booted = await bootBlobApp();
});

afterEach(async () =>
{
    await booted.cleanup();
});

//----------------------------------------------------------------------------------------------------------------------

describe('chunked upload', () =>
{
    it('commits the file when the last chunk lands, holding bytes that hash to the claim', async () =>
    {
        const user = await makeUser(booted, 'chunks@example.com');
        const data = randomBytes(3000);
        const sha256 = sha256Of(data);
        const ticket = await ticketFor(user, data);

        const first = await putChunk(booted.app, user.cookie, ticket, data.subarray(0, 1000), 0);
        const second = await putChunk(booted.app, user.cookie, ticket, data.subarray(1000, 2500), 1000);
        const last = await putChunk(booted.app, user.cookie, ticket, data.subarray(2500), 2500);

        expect(first.status).toBe(202);
        expect(second.status).toBe(202);
        expect(last.status).toBe(200);

        const node = await last.json() as NodeResponse;
        expect(node.type).toBe('file');
        expect(node.size).toBe(3000);

        expect(await storedBytes(booted, sha256)).toEqual(data);
        expect(await fileNodesForBlob(booted.handle, sha256)).toHaveLength(1);
    });

    it('answers every chunk before the last with how much of the file it now holds', async () =>
    {
        const user = await makeUser(booted, 'position@example.com');
        const data = randomBytes(3000);
        const ticket = await ticketFor(user, data);

        const first = await putChunk(booted.app, user.cookie, ticket, data.subarray(0, 1000), 0);
        const second = await putChunk(booted.app, user.cookie, ticket, data.subarray(1000, 2500), 1000);

        expect(await first.json() as UploadChunkAccepted).toEqual({ receivedBytes: 1000, totalBytes: 3000 });
        expect(await second.json() as UploadChunkAccepted).toEqual({ receivedBytes: 2500, totalBytes: 3000 });
    });

    it('commits nothing while the file is still incomplete', async () =>
    {
        const user = await makeUser(booted, 'incomplete@example.com');
        const data = randomBytes(3000);
        const sha256 = sha256Of(data);
        const ticket = await ticketFor(user, data);

        await putChunk(booted.app, user.cookie, ticket, data.subarray(0, 1000), 0);

        expect(await blobRowCount(booted.handle, sha256)).toBe(0);
        expect(await fileNodesForBlob(booted.handle, sha256)).toHaveLength(0);
        expect(await bytesExist(booted, sha256)).toBe(false);
    });

    it('refuses a chunk that skips ahead of where the upload stands, and accepts the right one after', async () =>
    {
        const user = await makeUser(booted, 'skip@example.com');
        const data = randomBytes(3000);
        const sha256 = sha256Of(data);
        const ticket = await ticketFor(user, data);

        await putChunk(booted.app, user.cookie, ticket, data.subarray(0, 1000), 0);

        const skipped = await putChunk(booted.app, user.cookie, ticket, data.subarray(2500), 2500);
        expect(skipped.status).toBe(409);

        // The refusal left the upload where it was, so the chunk that does belong next still lands.
        const resumed = await putChunk(booted.app, user.cookie, ticket, data.subarray(1000, 2500), 1000);
        expect(await resumed.json() as UploadChunkAccepted).toEqual({ receivedBytes: 2500, totalBytes: 3000 });

        const last = await putChunk(booted.app, user.cookie, ticket, data.subarray(2500), 2500);
        expect(last.status).toBe(200);
        expect(await storedBytes(booted, sha256)).toEqual(data);
    });

    it('refuses a chunk the upload already received rather than writing it twice', async () =>
    {
        const user = await makeUser(booted, 'replay@example.com');
        const data = randomBytes(3000);
        const sha256 = sha256Of(data);
        const ticket = await ticketFor(user, data);

        await putChunk(booted.app, user.cookie, ticket, data.subarray(0, 1000), 0);
        await putChunk(booted.app, user.cookie, ticket, data.subarray(1000, 2500), 1000);

        const replayed = await putChunk(booted.app, user.cookie, ticket, data.subarray(0, 1000), 0);
        expect(replayed.status).toBe(409);

        // The replay changed nothing: the upload finishes with the bytes it was always going to have.
        const last = await putChunk(booted.app, user.cookie, ticket, data.subarray(2500), 2500);
        expect(last.status).toBe(200);
        expect(await storedBytes(booted, sha256)).toEqual(data);
    });

    it('refuses a chunk that would carry the upload past the size it claimed', async () =>
    {
        const user = await makeUser(booted, 'overrun@example.com');
        const data = randomBytes(3000);
        const ticket = await ticketFor(user, data);

        await putChunk(booted.app, user.cookie, ticket, data.subarray(0, 2500), 0);

        const overrun = await putChunk(booted.app, user.cookie, ticket, randomBytes(600), 2500);

        expect(overrun.status).toBe(400);
    });

    it('refuses an offset past the end of the claimed file', async () =>
    {
        const user = await makeUser(booted, 'beyond@example.com');
        const data = randomBytes(3000);
        const ticket = await ticketFor(user, data);

        const beyond = await putChunk(booted.app, user.cookie, ticket, randomBytes(10), 4000);

        expect(beyond.status).toBe(400);
    });

    it('refuses a malformed offset instead of writing the bytes somewhere else', async () =>
    {
        const user = await makeUser(booted, 'malformed@example.com');
        const data = randomBytes(3000);
        const ticket = await ticketFor(user, data);

        const query = 'name=f.bin&mimeType=application/octet-stream&offset=nonsense';
        const res = await booted.app.request(`${ ORIGIN }/api/uploads/${ ticket }?${ query }`, {
            method: 'PUT',
            headers: { cookie: user.cookie },
            body: new Uint8Array(data.subarray(0, 100)),
        });

        expect(res.status).toBe(400);
    });

    it('refuses the assembled file when its bytes do not hash to the claim, storing nothing', async () =>
    {
        const user = await makeUser(booted, 'liar@example.com');
        const honest = randomBytes(3000);
        const sha256 = sha256Of(honest);
        const ticket = await ticketFor(user, honest);

        // Every chunk is well-formed on its own; only the assembled file betrays the lie.
        const forged = randomBytes(3000);
        await putChunk(booted.app, user.cookie, ticket, forged.subarray(0, 1500), 0);
        const last = await putChunk(booted.app, user.cookie, ticket, forged.subarray(1500), 1500);

        expect(last.status).toBe(400);
        expect(await blobRowCount(booted.handle, sha256)).toBe(0);
        expect(await fileNodesForBlob(booted.handle, sha256)).toHaveLength(0);
        expect(await bytesExist(booted, sha256)).toBe(false);
        expect(await partials()).toEqual([]);
    });

    it('refuses a chunk against a ticket nobody issued', async () =>
    {
        const user = await makeUser(booted, 'ghost@example.com');

        const res = await putChunk(booted.app, user.cookie, 'no-such-ticket', randomBytes(100), 0);

        expect(res.status).toBe(404);
    });

    it('refuses a chunk against another user\'s ticket', async () =>
    {
        const owner = await makeUser(booted, 'ticket-owner@example.com');
        const stranger = await makeUser(booted, 'stranger@example.com');
        const data = randomBytes(3000);
        const ticket = await ticketFor(owner, data);

        const res = await putChunk(booted.app, stranger.cookie, ticket, data.subarray(0, 1000), 0);

        expect(res.status).toBe(403);
    });

    it('replaces an existing file\'s content when the final chunk names the target', async () =>
    {
        const user = await makeUser(booted, 'replace-chunks@example.com');

        const original = randomBytes(2048);
        const created = await putUpload(
            booted.app,
            user.cookie,
            await ticketFor(user, original),
            original
        );
        const target = await created.json() as NodeResponse;

        const replacement = randomBytes(3000);
        const replacementSha = sha256Of(replacement);
        const ticket = await ticketFor(user, replacement);

        const head = replacement.subarray(0, 1500);
        const tail = replacement.subarray(1500);

        await putChunkReplace(booted.app, user.cookie, ticket, head, 0, target.id);
        const last = await putChunkReplace(booted.app, user.cookie, ticket, tail, 1500, target.id);

        expect(last.status).toBe(200);

        const row = await nodeContentRow(booted.handle, target.id);
        expect(row.blob_id).toBe(replacementSha);
        expect(row.size).toBe(3000);
        expect(await storedBytes(booted, replacementSha)).toEqual(replacement);
    });

    it('keeps a whole-file upload single-use: its ticket is spent on the one request', async () =>
    {
        const user = await makeUser(booted, 'single-use@example.com');
        const data = randomBytes(2048);
        const ticket = await ticketFor(user, data);

        expect((await putUpload(booted.app, user.cookie, ticket, data)).status).toBe(200);
        expect((await putUpload(booted.app, user.cookie, ticket, data)).status).toBe(404);
    });

    // The size is the deployment's, and the claim is the only place a client is told it -- so what comes back is
    // whatever this instance was configured with, never a constant compiled into either side.
    it('hands back the chunk size the instance is configured with', async () =>
    {
        const user = await makeUser(booted, 'sizing@example.com');

        const { chunkBytes } = await ticketResponseFor(user, randomBytes(64));

        expect(chunkBytes).toBe(DEFAULT_UPLOAD_CHUNK_BYTES);
    });

    // An instance that tuned the size gets uploads shaped by it: the claim reports the tuned number, chunks cut to it
    // are accepted in sequence, and the file that lands is byte-identical to one sent any other way. The size is small
    // enough that the same file needs several requests, so a client still using the default would send one oversized
    // chunk and be refused.
    it('delivers a file in chunks of a tuned size, end to end', async () =>
    {
        const tuned = 1024;
        const custom = await bootBlobApp({ uploadChunkBytes: tuned });

        try
        {
            const user = await makeUser(custom, 'tuned@example.com');
            const data = randomBytes(2500);
            const sha256 = sha256Of(data);

            const body = await (await claim(custom.app, user.cookie, sha256, data.length)).json() as ClaimResponse;
            if(body.upload !== true) { throw new Error('expected an upload ticket for an unknown blob'); }

            expect(body.chunkBytes).toBe(tuned);

            const ranges = chunkRanges(data.length, body.chunkBytes);
            expect(ranges).toEqual([ [ 0, 1024 ], [ 1024, 1024 ], [ 2048, 452 ] ]);

            const statuses : number[] = [];
            for(const [ offset, length ] of ranges)
            {
                // eslint-disable-next-line no-await-in-loop -- chunks are sequential by contract
                const res = await putChunk(
                    custom.app,
                    user.cookie,
                    body.ticket,
                    data.subarray(offset, offset + length),
                    offset
                );
                statuses.push(res.status);
            }

            expect(statuses).toEqual([ 202, 202, 200 ]);
            expect(await storedBytes(custom, sha256)).toEqual(data);
        }
        finally
        {
            await custom.cleanup();
        }
    });

    it('reclaims the staging of an abandoned upload and leaves one still delivering alone', async () =>
    {
        const user = await makeUser(booted, 'reaper@example.com');
        const data = randomBytes(3000);
        const sha256 = sha256Of(data);
        const ticket = await ticketFor(user, data);

        await putChunk(booted.app, user.cookie, ticket, data.subarray(0, 1000), 0);

        // A sweep over the real window leaves an upload that just delivered a chunk untouched, and the upload finishes.
        expect(await booted.blobs.sweepPartials()).toBe(0);
        expect(await partials()).toHaveLength(1);

        await putChunk(booted.app, user.cookie, ticket, data.subarray(1000), 1000);
        expect(await storedBytes(booted, sha256)).toEqual(data);

        // An upload nobody will finish: once its window closes -- a cutoff past everything staged so far -- its
        // staging is reclaimed.
        const abandoned = randomBytes(3000);
        const abandonedTicket = await ticketFor(user, abandoned);
        await putChunk(booted.app, user.cookie, abandonedTicket, abandoned.subarray(0, 1000), 0);

        expect(await booted.blobs.sweepPartials(new Date(Date.now() + 1000))).toBe(1);
        expect(await partials()).toEqual([]);
    });
});

//----------------------------------------------------------------------------------------------------------------------
