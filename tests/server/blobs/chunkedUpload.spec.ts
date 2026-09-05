//----------------------------------------------------------------------------------------------------------------------
// Chunked Upload Flow
//
// The upload arriving as a sequence of requests, driven through the real routes and manager against a real store. The
// contract being asserted: chunks are sequential and the ticket carries the position between them; nothing is committed
// until the last byte lands; a client and server that disagree about where the upload stands are told so rather than
// corrupting the file; and the assembled bytes face exactly the integrity check a single-stream upload faces.
//----------------------------------------------------------------------------------------------------------------------

import { createHash, randomBytes } from 'node:crypto';
import { readdir, utimes } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
    type ClaimResponse,
    DEFAULT_UPLOAD_CHUNK_BYTES,
    type NodeResponse,
    TICKET_TTL_MS,
    type UploadChunkAccepted,
} from '@fileshed/core';

// Managers
import { runPartialsOnce } from '@server/managers/partials.ts';

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
// A chunk that is still arriving
//----------------------------------------------------------------------------------------------------------------------

interface StallingChunk
{
    body : ReadableStream<Uint8Array>;
    finish : () => void;
}

// A request body that hands over its bytes and then stays open until it is told to end, so a second request arrives
// while the upload is genuinely mid-append -- the state a torn chunk's immediate retry meets.
function stallingChunk(bytes : Buffer) : StallingChunk
{
    let release : () => void = () => undefined;
    const held = new Promise<void>((resolve) => { release = resolve; });

    let handedOver = false;

    const body = new ReadableStream<Uint8Array>({
        async pull(stream)
        {
            if(handedOver)
            {
                await held;
                stream.close();

                return;
            }

            handedOver = true;
            stream.enqueue(new Uint8Array(bytes));
        },
    });

    return { body, finish: release };
}

// Wait until the upload is genuinely receiving a chunk, which the staging file appearing is the first outside sign of:
// the manager marks the ticket as receiving before it ever asks the store to append. The transport is no help here --
// a request body can be pulled while the request is still on its way to the handler, so a spec that keyed off the wire
// would race the very state it means to stand inside.
async function whenReceiving() : Promise<void>
{
    const deadline = Date.now() + 5000;

    for(;;)
    {
        // eslint-disable-next-line no-await-in-loop -- each look waits on the one before it
        if((await partials()).length > 0) { return; }

        if(Date.now() > deadline) { throw new Error('the upload never started receiving the stalled chunk'); }

        // eslint-disable-next-line no-await-in-loop -- give the request a moment to reach the handler
        await delay(10);
    }
}

async function putChunkStream(cookie : string, ticket : string, body : ReadableStream<Uint8Array>, offset : number)
: Promise<Response>
{
    const params = new URLSearchParams({
        name: 'file.bin',
        mimeType: 'application/octet-stream',
        offset: String(offset),
    });

    return booted.app.request(`${ ORIGIN }/api/uploads/${ ticket }?${ params.toString() }`, {
        method: 'PUT',
        headers: { cookie },
        body,
        // Required whenever the body is a stream. The DOM RequestInit these tests compile against does not model it.
        duplex: 'half',
    } as RequestInit);
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

        const node = await last.json() as Extract<NodeResponse, { type : 'file' }>;
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

        // Where the upload actually stands rides the refusal: the client asked about byte 2500 and is told the upload
        // holds 1000, which is the byte its next chunk belongs at.
        expect(await skipped.json()).toMatchObject({ code: 'upload.offsetConflict', receivedBytes: 1000 });

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

        // Named as the client's mistake, never as the transient one it retries: a replay coded chunkInFlight would
        // be re-sent three times and then fail the upload over bytes the server already had. The position it is
        // ahead by comes with it, so the client can pick the upload back up instead of giving up on it.
        expect(await replayed.json()).toMatchObject({ code: 'upload.offsetConflict', receivedBytes: 2500 });

        // The replay changed nothing: the upload finishes with the bytes it was always going to have.
        const last = await putChunk(booted.app, user.cookie, ticket, data.subarray(2500), 2500);
        expect(last.status).toBe(200);
        expect(await storedBytes(booted, sha256)).toEqual(data);
    });

    // The whole point of naming the position: a client that has lost track of the upload -- a torn chunk the server
    // took in full, a session picking a ticket back up -- reads where to start from the refusal itself and finishes
    // the file, with no round trip spent on discovering it and no bytes sent twice.
    it('tells a client that disagreed about the position where to resume, and takes the file from there', async () =>
    {
        const user = await makeUser(booted, 'resume@example.com');
        const data = randomBytes(3000);
        const sha256 = sha256Of(data);
        const ticket = await ticketFor(user, data);

        await putChunk(booted.app, user.cookie, ticket, data.subarray(0, 1000), 0);
        await putChunk(booted.app, user.cookie, ticket, data.subarray(1000, 2500), 1000);

        // The client believes it still owes byte 1000 onwards; the server has been past that for a request now.
        const stale = await putChunk(booted.app, user.cookie, ticket, data.subarray(1000, 2500), 1000);
        const { receivedBytes } = await stale.json() as { receivedBytes : number };

        const resumed = await putChunk(booted.app, user.cookie, ticket, data.subarray(receivedBytes), receivedBytes);

        expect(resumed.status).toBe(200);
        expect(await storedBytes(booted, sha256)).toEqual(data);
    });

    // Both refusals are 409, and they ask opposite things of the client. A chunk overlapping one still being received
    // is a torn chunk meeting its own dead request: nothing is wrong with the bytes and the ground is still theirs
    // once it unwinds. A chunk at an offset the upload disagrees with is wrong however many times it is sent. The code
    // is the only thing on the wire that separates them.
    it('refuses an overlapping chunk and a misplaced one under codes that tell the two apart', async () =>
    {
        const user = await makeUser(booted, 'inflight@example.com');
        const data = randomBytes(3000);
        const ticket = await ticketFor(user, data);

        const stalled = stallingChunk(data.subarray(0, 1500));
        const receiving = putChunkStream(user.cookie, ticket, stalled.body, 0);
        await whenReceiving();

        const overlapping = await putChunk(booted.app, user.cookie, ticket, data.subarray(0, 1500), 0);

        stalled.finish();
        await receiving;

        const misplaced = await putChunk(booted.app, user.cookie, ticket, data.subarray(2500), 2500);

        expect([ overlapping.status, misplaced.status ]).toEqual([ 409, 409 ]);
        expect(await overlapping.json()).toMatchObject({ code: 'upload.chunkInFlight' });
        expect(await misplaced.json()).toMatchObject({ code: 'upload.offsetConflict' });
    });

    it('stores the file byte-for-byte after a chunk was refused for overlapping one still in flight', async () =>
    {
        const user = await makeUser(booted, 'race-survivor@example.com');
        const data = randomBytes(3000);
        const sha256 = sha256Of(data);
        const ticket = await ticketFor(user, data);

        const stalled = stallingChunk(data.subarray(0, 1500));
        const receiving = putChunkStream(user.cookie, ticket, stalled.body, 0);
        await whenReceiving();

        expect((await putChunk(booted.app, user.cookie, ticket, data.subarray(0, 1500), 0)).status).toBe(409);

        // The refused chunk read no bytes, so the upload stands exactly where the chunk it overlapped left it.
        stalled.finish();
        expect(await (await receiving).json() as UploadChunkAccepted)
            .toEqual({ receivedBytes: 1500, totalBytes: 3000 });

        const last = await putChunk(booted.app, user.cookie, ticket, data.subarray(1500), 1500);

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

    // Two passes rather than one, because an upload mid-delivery and an abandoned one cannot be staged side by side
    // here -- the first has to finish before the second can start. A pass over a mixed staging directory is proven
    // against the reaper directly, in the partials spec.
    it('spares an upload that just delivered a chunk, and reclaims one nobody came back to', async () =>
    {
        const user = await makeUser(booted, 'reaper@example.com');
        const data = randomBytes(3000);
        const sha256 = sha256Of(data);
        const ticket = await ticketFor(user, data);

        await putChunk(booted.app, user.cookie, ticket, data.subarray(0, 1000), 0);

        // A sweep over the real window leaves an upload that just delivered a chunk untouched, and the upload finishes.
        expect(await runPartialsOnce({ blob: booted.blob, ttlMs: TICKET_TTL_MS }))
            .toMatchObject({ candidates: 0, reclaimed: 0 });
        expect(await partials()).toHaveLength(1);

        await putChunk(booted.app, user.cookie, ticket, data.subarray(1000), 1000);
        expect(await storedBytes(booted, sha256)).toEqual(data);

        // An upload nobody will finish. Aged past the window by hand rather than waited out, since what separates it
        // from a slow upload is only how long its staging has sat untouched.
        const abandoned = randomBytes(3000);
        const abandonedTicket = await ticketFor(user, abandoned);
        await putChunk(booted.app, user.cookie, abandonedTicket, abandoned.subarray(0, 1000), 0);

        const aged = new Date(Date.now() - (TICKET_TTL_MS * 2));
        const staged = await partials();
        await Promise.all(staged.map((name) => utimes(join(booted.storageRoot, '.partials', name), aged, aged)));

        expect(await runPartialsOnce({ blob: booted.blob, ttlMs: TICKET_TTL_MS }))
            .toMatchObject({ candidates: 1, reclaimed: 1, bytesFreed: 1000 });
        expect(await partials()).toEqual([]);
    });
});

//----------------------------------------------------------------------------------------------------------------------
