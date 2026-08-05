//----------------------------------------------------------------------------------------------------------------------
// E2E -- Chunked upload
//
// A file too large for one request, delivered the way the client delivers it: claim once, then PUT each chunk against
// the ticket in order. Driven over real sockets against a real server, and asserted against the bytes actually on disk
// -- the point of chunking is that the assembled file is indistinguishable from one that arrived in a single stream.
//
// The second half of the story is the one that matters when a network misbehaves: a chunk cut off mid-flight, then
// sent again. The bytes the torn attempt managed to deliver must leave no trace, or the file would come out longer
// than it went in and fail its own hash.
//
// The server runs with a chunk size its environment chose rather than the compiled default, so the size a client
// plans against is proven to be the deployment's own -- across a real process, where nothing but the claim response
// carries it.
//----------------------------------------------------------------------------------------------------------------------

import { randomBytes } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
    type ClaimResponse,
    DEFAULT_UPLOAD_CHUNK_BYTES,
    type NodeResponse,
    type UploadChunkAccepted,
} from '@fileshed/core';

// Support
import {
    ApiClient,
    type ServerHandle,
    readBlobFile,
    sha256Of,
    spawnServer,
    withDb,
} from './support.ts';

//----------------------------------------------------------------------------------------------------------------------

const PASSWORD = 'correct-horse-battery';

let server : ServerHandle;
let alice : ApiClient;

// The chunk size this deployment is configured with -- deliberately not the compiled default, so a client that fell
// back to the constant would cut this file into the wrong number of requests and be caught doing it. Above the 1 MiB
// floor, and small enough that the fixture stays cheap to move.
const CONFIGURED_CHUNK_BYTES = 2 * 1024 * 1024;

// One chunk's worth plus a remainder, so the file needs two requests and the second one is short -- the shape every
// real file has.
const TAIL_BYTES = 4096;

function uploadQuery(name : string, offset : number) : string
{
    return new URLSearchParams({ name, mimeType: 'application/octet-stream', offset: String(offset) }).toString();
}

// The claim's ticket half: the ticket to write against and the chunk size to cut the file into, which is the only
// place a client learns what this instance wants.
async function ticketFor(client : ApiClient, data : Buffer) : Promise<{ ticket : string; chunkBytes : number }>
{
    const claim = await (await client.post('/api/blobs/claim', { sha256: sha256Of(data), size: data.length }))
        .json() as ClaimResponse;

    if(claim.upload !== true) { throw new Error('setup: expected an upload ticket for an unknown blob'); }

    return { ticket: claim.ticket, chunkBytes: claim.chunkBytes };
}

function putChunk(client : ApiClient, ticket : string, name : string, data : Buffer, offset : number, length : number)
: Promise<Response>
{
    return client.put(
        `/api/uploads/${ ticket }?${ uploadQuery(name, offset) }`,
        data.subarray(offset, offset + length)
    );
}

//----------------------------------------------------------------------------------------------------------------------
// Tearing a request mid-flight
//----------------------------------------------------------------------------------------------------------------------

// How long a dead socket may take to finish unwinding inside the server before the spec calls it a failure. Generous:
// a contended machine is slow, not broken, and the happy path never spends any of this.
const TEARDOWN_BUDGET_MS = 30_000;

// A request body that hands over `bytes` and then never ends, so the request stays open until the caller aborts it.
// `onWire` settles once the transport has pulled those bytes -- the moment a tear can actually tear something. A fixed
// delay cannot promise that: on a loaded machine it fires before the request was ever dispatched, and the spec then
// proves nothing while still passing.
function hangingBody(bytes : Buffer) : { body : ReadableStream<Uint8Array>; onWire : Promise<void> }
{
    let pulled : () => void = () => undefined;
    const onWire = new Promise<void>((resolve) => { pulled = resolve; });

    let handedOver = false;

    const body = new ReadableStream<Uint8Array>({
        pull(stream)
        {
            // Asked for more after the first handover: answer with a promise that never settles, which is how a body
            // says "later" without ending the request.
            if(handedOver) { return new Promise<void>(() => undefined); }

            handedOver = true;
            stream.enqueue(new Uint8Array(bytes));
            pulled();

            return undefined;
        },
    });

    return { body, onWire };
}

// Send a chunk, waiting out the window in which the server is still unwinding the request that just died. A chunk
// overlapping one still being received is refused by design -- that refusal is the server working, not the retry
// failing -- so the spec polls against a wall-clock deadline instead of assuming the socket died fast enough. A
// refusal that never clears fails loudly, carrying the server's own words.
async function putChunkOnceReceiving(
    client : ApiClient,
    ticket : string,
    name : string,
    data : Buffer,
    offset : number,
    length : number
) : Promise<Response>
{
    const deadline = Date.now() + TEARDOWN_BUDGET_MS;

    for(;;)
    {
        // eslint-disable-next-line no-await-in-loop -- each attempt waits on the one before it
        const res = await putChunk(client, ticket, name, data, offset, length);
        if(res.status !== 409) { return res; }

        // eslint-disable-next-line no-await-in-loop -- read the refusal so it can be reported if it never clears
        const refusal = await res.text();
        if(Date.now() > deadline)
        {
            throw new Error(`chunk at ${ offset } still refused after ${ TEARDOWN_BUDGET_MS }ms: ${ refusal }`);
        }

        // eslint-disable-next-line no-await-in-loop -- give the server a moment before asking again
        await delay(25);
    }
}

//----------------------------------------------------------------------------------------------------------------------

beforeAll(async () =>
{
    server = await spawnServer({ env: { UPLOAD_CHUNK_BYTES: String(CONFIGURED_CHUNK_BYTES) } });

    alice = new ApiClient(server.baseURL);
    await alice.signUp('alice@example.com', PASSWORD);
});

afterAll(async () =>
{
    await server?.stop();
});

//----------------------------------------------------------------------------------------------------------------------

describe('a file larger than one chunk', () =>
{
    const data = randomBytes(CONFIGURED_CHUNK_BYTES + TAIL_BYTES);
    const sha = sha256Of(data);

    let claimedChunkBytes : number;
    let accepted : UploadChunkAccepted;
    let committed : NodeResponse;

    beforeAll(async () =>
    {
        const { ticket, chunkBytes } = await ticketFor(alice, data);
        claimedChunkBytes = chunkBytes;

        const first = await putChunk(alice, ticket, 'large.bin', data, 0, chunkBytes);
        expect(first.status).toBe(202);
        accepted = await first.json() as UploadChunkAccepted;

        const last = await putChunk(alice, ticket, 'large.bin', data, chunkBytes, TAIL_BYTES);
        expect(last.status).toBe(200);
        committed = await last.json() as NodeResponse;
    });

    // The number the deployment's environment set, arriving at the client with its ticket. Nothing else on the wire
    // carries it, so a client planning from the compiled constant would cut this file at the wrong boundary.
    it('hands the client the chunk size this instance was configured with, not the compiled default', () =>
    {
        expect(claimedChunkBytes).toBe(CONFIGURED_CHUNK_BYTES);
        expect(claimedChunkBytes).not.toBe(DEFAULT_UPLOAD_CHUNK_BYTES);
    });

    it('holds the first chunk without committing anything, reporting how much of the file it has', () =>
    {
        expect(accepted).toEqual({ receivedBytes: CONFIGURED_CHUNK_BYTES, totalBytes: data.length });
    });

    it('commits the file node on the chunk carrying the last byte', () =>
    {
        expect(committed.type).toBe('file');
        if(committed.type !== 'file') { throw new Error('expected a file node'); }

        expect(committed.name).toBe('large.bin');
        expect(committed.size).toBe(data.length);
        expect(committed.blobID).toBe(sha);
    });

    it('stores the assembled bytes, hashing to the sha256 the claim named', async () =>
    {
        const stored = await readBlobFile(server.storageRoot, sha);

        expect(stored.length).toBe(data.length);
        expect(sha256Of(stored)).toBe(sha);
        expect(stored.equals(data)).toBe(true);
    });

    it('records one blob at the claimed size, pinned and live', async () =>
    {
        const blob = await withDb(server, (db) => db
            .selectFrom('blob')
            .selectAll()
            .where('sha256', '=', sha)
            .executeTakeFirst());

        expect(blob?.size).toBe(data.length);
        expect(blob?.storage_key).toBe(sha);
        expect(blob?.deleted_at).toBeNull();
    });
});

//----------------------------------------------------------------------------------------------------------------------

describe('a chunk cut off mid-flight', () =>
{
    // Small chunks: the interruption has to land inside a chunk, and tearing a multi-megabyte request would spend most
    // of the test moving bytes. Offsets are the client's to choose, so the server behaves the same at any size.
    const CHUNK = 64 * 1024;

    const data = randomBytes(CHUNK * 3);
    const sha = sha256Of(data);

    it('drops what the torn attempt delivered and stores the file exactly once it is sent again', async () =>
    {
        const { ticket } = await ticketFor(alice, data);

        expect((await putChunk(alice, ticket, 'torn.bin', data, 0, CHUNK)).status).toBe(202);

        // The second chunk starts arriving and the connection dies before it is whole. The outcome is captured either
        // way rather than left floating, so a request that fails before its bytes are ever pulled cannot surface as an
        // unhandled rejection or hang the spec waiting for a handover that will never come.
        const controller = new AbortController();
        const torn = hangingBody(data.subarray(CHUNK, CHUNK + 1024));

        const request = alice
            .putStream(`/api/uploads/${ ticket }?${ uploadQuery('torn.bin', CHUNK) }`, torn.body, controller.signal)
            .then(() => 'completed', () => 'failed');

        await Promise.race([ torn.onWire, request ]);
        controller.abort();

        expect(await request).toBe('failed');

        // The same chunk, sent again in full: the upload picks up exactly where it stood, not where the tear left it.
        const retried = await putChunkOnceReceiving(alice, ticket, 'torn.bin', data, CHUNK, CHUNK);
        expect(retried.status).toBe(202);
        expect(await retried.json() as UploadChunkAccepted).toEqual({
            receivedBytes: CHUNK * 2,
            totalBytes: data.length,
        });

        const last = await putChunk(alice, ticket, 'torn.bin', data, CHUNK * 2, CHUNK);
        expect(last.status).toBe(200);

        const stored = await readBlobFile(server.storageRoot, sha);
        expect(stored.length).toBe(data.length);
        expect(sha256Of(stored)).toBe(sha);
    });
});

//----------------------------------------------------------------------------------------------------------------------
