//----------------------------------------------------------------------------------------------------------------------
// Chunked Upload
//
// Drives the sequencing against a fake transport that records every request and decides each outcome, so the specs
// assert the requests the uploader actually makes -- which bytes went, at which offset, in which order, and how often
// after a failure. The chunk plan runs for real; only the wire is faked.
//----------------------------------------------------------------------------------------------------------------------

import { type Mock, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    type NodeResponse,
    UPLOAD_CHUNK_IN_FLIGHT_MAX_ATTEMPTS,
    UPLOAD_CHUNK_MAX_ATTEMPTS,
} from '@fileshed/core';

// Resource Access (under test)
import { ApiError, ConflictApiError } from '@client/resource-access/apiError.ts';
import { uploadChunked } from '@client/resource-access/chunkedUpload.ts';
import {
    type UploadOutcome,
    type UploadWithProgressOptions,
    uploadWithProgress,
} from '@client/resource-access/uploadWithProgress.ts';

//----------------------------------------------------------------------------------------------------------------------

vi.mock('@client/resource-access/uploadWithProgress.ts', () => ({ uploadWithProgress: vi.fn() }));

const uploadMock = uploadWithProgress as unknown as Mock;

//----------------------------------------------------------------------------------------------------------------------

const ISO = '2026-07-01T00:00:00.000Z';

const COMMIT = { name: 'f.bin', parentID: null, mimeType: 'application/octet-stream' };

function committedNode() : NodeResponse
{
    return {
        sharing: null,
        id: 'n1',
        name: 'f.bin',
        ownerID: 'u1',
        parentID: null,
        createdAt: ISO,
        updatedAt: ISO,
        role: 'owner',
        type: 'file',
        blobID: 'b1',
        size: 10,
        mimeType: 'application/octet-stream',
        trashedAt: null,
    };
}

// One request as the transport saw it: where the bytes belonged and what they were.
interface SentChunk
{
    offset : number;
    text : string;
}

// What the server does with a chunk: takes it and waits for more, commits the file, or -- by throwing -- fails.
type ChunkScript = (sent : SentChunk, callNumber : number) => UploadOutcome;

// What a real 202 carries: the upload's position after these bytes landed, which is the end of the chunk that was
// just accepted. The client reads it, so a fixture that answered zero would be describing a server that took the
// bytes and stayed where it was.
function accepted(chunk : SentChunk, totalBytes ?: number) : UploadOutcome
{
    const receivedBytes = chunk.offset + chunk.text.length;

    return { committed: false, receivedBytes, totalBytes: totalBytes ?? receivedBytes };
}

function commits() : UploadOutcome
{
    return { committed: true, node: committedNode() };
}

// Far above what any spec here legitimately sends, and low enough to trip in milliseconds. An upload that keeps
// resuming forever is the failure this file most needs to catch, and a hang is the one failure a test cannot report:
// it stops the run instead of failing an assertion, and reads as an environment problem rather than a bug.
const RUNAWAY_REQUESTS = 64;

// A transport that records every request and answers each the way the spec's script says, taking the bytes and waiting
// for more unless told otherwise.
function fakeTransport(script : ChunkScript = accepted) : SentChunk[]
{
    const sent : SentChunk[] = [];
    let calls = 0;

    uploadMock.mockImplementation(async (options : UploadWithProgressOptions) : Promise<UploadOutcome> =>
    {
        calls += 1;

        if(calls > RUNAWAY_REQUESTS)
        {
            throw new Error(`the upload made more than ${ RUNAWAY_REQUESTS } requests; it is not making progress`);
        }

        const chunk : SentChunk = { offset: options.offset ?? 0, text: await options.body.text() };
        sent.push(chunk);

        return script(chunk, calls);
    });

    return sent;
}

// The common script: every chunk is taken, and the one starting at `commitAt` completes the file.
function commitsAt(offset : number) : ChunkScript
{
    return (chunk) =>
    {
        return chunk.offset === offset ? commits() : accepted(chunk);
    };
}

// A file whose content says where each byte came from, so a mis-sliced chunk is visible in the assertion rather than
// hiding behind a byte count.
function fileOf(text : string) : Blob
{
    return new Blob([ text ]);
}

//----------------------------------------------------------------------------------------------------------------------

describe('uploadChunked', () =>
{
    beforeEach(() =>
    {
        uploadMock.mockReset();
    });

    it('sends one request per chunk, in order, each carrying its own slice at its own offset', async () =>
    {
        const sent = fakeTransport(commitsAt(8));

        await uploadChunked({ ticket: 'TKT', file: fileOf('abcdefghij'), commit: COMMIT, chunkBytes: 4 });

        expect(sent).toEqual([
            { offset: 0, text: 'abcd' },
            { offset: 4, text: 'efgh' },
            { offset: 8, text: 'ij' },
        ]);
    });

    it('answers with the node the completing chunk committed', async () =>
    {
        fakeTransport(commitsAt(4));

        const node = await uploadChunked({ ticket: 'TKT', file: fileOf('abcdef'), commit: COMMIT, chunkBytes: 4 });

        expect(node.id).toBe('n1');
    });

    it('sends a file smaller than one chunk as a single request at the start of the file', async () =>
    {
        const sent = fakeTransport(() => commits());

        await uploadChunked({ ticket: 'TKT', file: fileOf('abc'), commit: COMMIT, chunkBytes: 4096 });

        expect(sent).toEqual([ { offset: 0, text: 'abc' } ]);
    });

    // Every 202 says where the upload now stands, and that count is the upload's position -- not the client's own
    // arithmetic about what it just sent. A server that took part of a chunk is answered from where it actually got
    // to, on the next request rather than after a refusal has been spent finding out.
    it('continues from the position the server reports, not from the end of the chunk it sent', async () =>
    {
        const sent = fakeTransport((chunk) =>
        {
            if(chunk.offset === 0) { return { committed: false, receivedBytes: 2, totalBytes: 10 }; }

            return chunk.offset + chunk.text.length >= 10 ? commits() : accepted(chunk);
        });

        await uploadChunked({ ticket: 'TKT', file: fileOf('abcdefghij'), commit: COMMIT, chunkBytes: 4 });

        expect(sent.map((chunk) => chunk.offset)).toEqual([ 0, 2, 6 ]);
        expect(sent[1]?.text).toBe('cdef');
    });

    // A server cannot take bytes and stay where it was. Believing it would replan the same chunk forever, so the
    // upload stops instead of spinning.
    it('refuses an acceptance that does not move the upload forward', async () =>
    {
        fakeTransport(() => ({ committed: false, receivedBytes: 0, totalBytes: 10 }));

        const upload = uploadChunked({ ticket: 'TKT', file: fileOf('abcdefghij'), commit: COMMIT, chunkBytes: 4 });

        await expect(upload).rejects.toThrow(/without moving forward/u);
    });

    it('re-sends only the failed chunk, leaving the chunks already accepted alone', async () =>
    {
        const sent = fakeTransport((chunk, call) =>
        {
            if(chunk.offset === 4 && call === 2) { throw new ApiError(0, 'The upload could not reach the server.'); }

            return chunk.offset === 8 ? commits() : accepted(chunk);
        });

        await uploadChunked({
            ticket: 'TKT',
            file: fileOf('abcdefghij'),
            commit: COMMIT,
            chunkBytes: 4,
            retryDelayMs: 0,
        });

        expect(sent).toEqual([
            { offset: 0, text: 'abcd' },
            { offset: 4, text: 'efgh' },
            { offset: 4, text: 'efgh' },
            { offset: 8, text: 'ij' },
        ]);
    });

    // Nothing injected, so what is under test is the budget the client actually ships with rather than a number this
    // spec chose. Wire the wrong constant here and the shipped upload retries the wrong number of times.
    it('stops a chunk the transport never carries at the end of the shipped transport budget', async () =>
    {
        const sent = fakeTransport(() =>
        {
            throw new ApiError(0, 'The upload could not reach the server.');
        });

        await expect(uploadChunked({
            ticket: 'TKT',
            file: fileOf('abcdefgh'),
            commit: COMMIT,
            chunkBytes: 4,
            retryDelayMs: 0,
            inFlightRetryDelayMs: 0,
        })).rejects.toBeInstanceOf(ApiError);

        expect(sent).toHaveLength(UPLOAD_CHUNK_MAX_ATTEMPTS);
    });

    // The transport budget is the transport's. A generous allowance for a busy ticket is not an allowance for a
    // network that never answers, so the chunk stops after the attempts the transport was given.
    it('gives up on a chunk after its transport budget and surfaces the failure', async () =>
    {
        const sent = fakeTransport(() =>
        {
            throw new ApiError(0, 'The upload could not reach the server.');
        });

        await expect(uploadChunked({
            ticket: 'TKT',
            file: fileOf('abcdefgh'),
            commit: COMMIT,
            chunkBytes: 4,
            maxAttempts: 3,
            retryDelayMs: 0,
            inFlightMaxAttempts: 9,
            inFlightRetryDelayMs: 0,
        })).rejects.toBeInstanceOf(ApiError);

        expect(sent).toHaveLength(3);
    });

    it('does not retry a refusal the server meant', async () =>
    {
        const sent = fakeTransport(() =>
        {
            throw new ApiError(403, 'This would put you over your storage quota.');
        });

        await expect(uploadChunked({
            ticket: 'TKT',
            file: fileOf('abcdefgh'),
            commit: COMMIT,
            chunkBytes: 4,
            retryDelayMs: 0,
        })).rejects.toMatchObject({ status: 403 });

        expect(sent).toHaveLength(1);
    });

    // The server refuses a chunk overlapping one it is still receiving, which is what a chunk's own torn attempt looks
    // like while its dead request unwinds. Nothing is wrong with these bytes, and the ground they want is still theirs
    // once it has -- so the same chunk goes again rather than the upload failing under the user.
    it('sends a chunk again when the upload was still receiving the attempt it is retrying', async () =>
    {
        const sent = fakeTransport((chunk, call) =>
        {
            if(chunk.offset === 4 && call === 2)
            {
                throw new ConflictApiError(
                    'Another chunk of this upload is still being received.',
                    'upload.chunkInFlight'
                );
            }

            return chunk.offset === 8 ? commits() : accepted(chunk);
        });

        const node = await uploadChunked({
            ticket: 'TKT',
            file: fileOf('abcdefghij'),
            commit: COMMIT,
            chunkBytes: 4,
            retryDelayMs: 0,
            inFlightRetryDelayMs: 0,
        });

        expect(node.id).toBe('n1');
        expect(sent).toEqual([
            { offset: 0, text: 'abcd' },
            { offset: 4, text: 'efgh' },
            { offset: 4, text: 'efgh' },
            { offset: 8, text: 'ij' },
        ]);
    });

    // A busy ticket is waited out on its own allowance. Spending the transport's would charge the client twice for
    // one tear -- once for the request that died, and again for the refusal that death caused.
    it('waits out a ticket that never stops receiving on its own budget, not the transport\'s', async () =>
    {
        const sent = fakeTransport(() =>
        {
            throw new ConflictApiError('Another chunk of this upload is still being received.', 'upload.chunkInFlight');
        });

        await expect(uploadChunked({
            ticket: 'TKT',
            file: fileOf('abcdefgh'),
            commit: COMMIT,
            chunkBytes: 4,
            maxAttempts: 2,
            retryDelayMs: 0,
            inFlightMaxAttempts: 5,
            inFlightRetryDelayMs: 0,
        })).rejects.toMatchObject({ status: 409, code: 'upload.chunkInFlight' });

        expect(sent).toHaveLength(5);
    });

    // The budget a real upload runs on, rather than one the spec handed it. The boundary is the point: the last
    // attempt the budget allows is the last one made, and its refusal is what fails the chunk.
    it('stops asking a ticket that never frees at the end of the shipped in-flight budget', async () =>
    {
        const sent = fakeTransport(() =>
        {
            throw new ConflictApiError('Another chunk of this upload is still being received.', 'upload.chunkInFlight');
        });

        await expect(uploadChunked({
            ticket: 'TKT',
            file: fileOf('abcdefgh'),
            commit: COMMIT,
            chunkBytes: 4,
            inFlightRetryDelayMs: 0,
        })).rejects.toMatchObject({ status: 409, code: 'upload.chunkInFlight' });

        expect(sent).toHaveLength(UPLOAD_CHUNK_IN_FLIGHT_MAX_ATTEMPTS);
    });

    // The tear and the refusal it leaves behind are one event on the wire and two budgets here: the dead request is
    // the transport's to account for, and the ticket it left busy gets its full allowance afterwards.
    it('does not let the tear that made a ticket busy spend the waiting-it-out budget', async () =>
    {
        const sent = fakeTransport((chunk, call) =>
        {
            if(call === 1) { throw new ApiError(0, 'The upload could not reach the server.'); }

            throw new ConflictApiError('Another chunk of this upload is still being received.', 'upload.chunkInFlight');
        });

        await expect(uploadChunked({
            ticket: 'TKT',
            file: fileOf('abcdefgh'),
            commit: COMMIT,
            chunkBytes: 4,
            maxAttempts: 3,
            retryDelayMs: 0,
            inFlightMaxAttempts: 4,
            inFlightRetryDelayMs: 0,
        })).rejects.toMatchObject({ status: 409, code: 'upload.chunkInFlight' });

        expect(sent).toHaveLength(5);
    });

    // The other 409: the two sides disagree about where the upload stands. A refusal that does not say where the
    // server stands leaves the client nowhere to go, so it surfaces rather than guessing at a position.
    it('fails a chunk refused for its offset when the refusal names no position', async () =>
    {
        const sent = fakeTransport(() =>
        {
            throw new ConflictApiError(
                'The chunk starts at 4, but the upload holds 0 bytes.',
                'upload.offsetConflict'
            );
        });

        await expect(uploadChunked({
            ticket: 'TKT',
            file: fileOf('abcdefgh'),
            commit: COMMIT,
            chunkBytes: 4,
            retryDelayMs: 0,
        })).rejects.toMatchObject({ status: 409, code: 'upload.offsetConflict' });

        expect(sent).toHaveLength(1);
    });

    // The server holds ground the client thought it still owed. Its count is the one that decides, so the rest of the
    // file is cut again from there and the bytes it already has are never sent a second time.
    it('cuts the rest of the file from the position an offset conflict reports', async () =>
    {
        const sent = fakeTransport((chunk, call) =>
        {
            if(chunk.offset === 4 && call === 2)
            {
                throw new ConflictApiError('This chunk was already received.', 'upload.offsetConflict', 8);
            }

            return chunk.offset === 8 ? commits() : accepted(chunk);
        });

        const node = await uploadChunked({
            ticket: 'TKT',
            file: fileOf('abcdefghij'),
            commit: COMMIT,
            chunkBytes: 4,
            retryDelayMs: 0,
        });

        expect(node.id).toBe('n1');
        expect(sent).toEqual([
            { offset: 0, text: 'abcd' },
            { offset: 4, text: 'efgh' },
            { offset: 8, text: 'ij' },
        ]);
    });

    // The half of the torn-chunk race the client used to die on: the dead request had already delivered its whole
    // chunk, so the retry is sending bytes the server holds. That is a resume, not a failed upload.
    it('finishes an upload whose torn chunk the server had already taken in full', async () =>
    {
        const sent = fakeTransport((chunk, call) =>
        {
            if(chunk.offset === 4 && call === 2) { throw new ApiError(0, 'The upload could not reach the server.'); }
            if(chunk.offset === 4 && call === 3)
            {
                throw new ConflictApiError('This chunk was already received.', 'upload.offsetConflict', 8);
            }

            return chunk.offset === 8 ? commits() : accepted(chunk);
        });

        const node = await uploadChunked({
            ticket: 'TKT',
            file: fileOf('abcdefghij'),
            commit: COMMIT,
            chunkBytes: 4,
            retryDelayMs: 0,
        });

        expect(node.id).toBe('n1');
        expect(sent).toEqual([
            { offset: 0, text: 'abcd' },
            { offset: 4, text: 'efgh' },
            { offset: 4, text: 'efgh' },
            { offset: 8, text: 'ij' },
        ]);
    });

    // A position outside the file is not a position in it. Sending a chunk there would only earn a second refusal, so
    // the conflict the client already has is the one it surfaces.
    it('does not restart from a position past the end of the file', async () =>
    {
        const sent = fakeTransport(() =>
        {
            throw new ConflictApiError('The upload holds 99 bytes.', 'upload.offsetConflict', 99);
        });

        await expect(uploadChunked({
            ticket: 'TKT',
            file: fileOf('abcdefghij'),
            commit: COMMIT,
            chunkBytes: 4,
            retryDelayMs: 0,
        })).rejects.toMatchObject({ status: 409, code: 'upload.offsetConflict' });

        expect(sent).toHaveLength(1);
    });

    // The other end of the same rule, and the one that bites: a position at or behind where this upload has already
    // sent from is no progress, and acting on it sends the same bytes to the same answer forever. Every one of these
    // must cost exactly the one request that earned the refusal.
    it.each([
        [ 'below the start of the file', -1 ],
        [ 'at the start, which the upload has already sent from', 0 ],
        [ 'behind where the upload already stands', 2 ],
        [ 'between two bytes', 6.5 ],
    ])('refuses to restart from a position %s', async (_case, position) =>
    {
        const sent = fakeTransport((chunk) =>
        {
            if(chunk.offset === 0) { return accepted(chunk); }

            throw new ConflictApiError(`The upload holds ${ position } bytes.`, 'upload.offsetConflict', position);
        });

        await expect(uploadChunked({
            ticket: 'TKT',
            file: fileOf('abcdefghij'),
            commit: COMMIT,
            chunkBytes: 4,
            retryDelayMs: 0,
        })).rejects.toMatchObject({ status: 409, code: 'upload.offsetConflict' });

        // The first chunk, then the second that was refused. A restart would show as a third.
        expect(sent).toHaveLength(2);
    });

    // A correction to the very end of the file is a resume like any other. What is owed from there is the empty
    // remainder, and the request carrying it is what commits the upload -- so a server that already holds every byte
    // is one request from being done, not stuck.
    it('resumes to the end of the file and lets the final request commit it', async () =>
    {
        const sent = fakeTransport((chunk) =>
        {
            if(chunk.offset === 10) { return commits(); }

            throw new ConflictApiError('The upload holds 10 bytes.', 'upload.offsetConflict', 10);
        });

        await expect(uploadChunked({
            ticket: 'TKT',
            file: fileOf('abcdefghij'),
            commit: COMMIT,
            chunkBytes: 4,
            retryDelayMs: 0,
        })).resolves.toMatchObject({ id: 'n1' });

        expect(sent).toEqual([
            { offset: 0, text: 'abcd' },
            { offset: 10, text: '' },
        ]);
    });

    // Restarting where the upload has already stood sends the same bytes to the same answer, and a server that keeps
    // naming such a position would keep the upload going forever. It only ever restarts somewhere new.
    it('does not restart at a position the upload has already sent from', async () =>
    {
        const sent = fakeTransport((chunk) =>
        {
            if(chunk.offset === 4)
            {
                throw new ConflictApiError('The upload holds 0 bytes.', 'upload.offsetConflict', 0);
            }

            return accepted(chunk);
        });

        await expect(uploadChunked({
            ticket: 'TKT',
            file: fileOf('abcdefghij'),
            commit: COMMIT,
            chunkBytes: 4,
            retryDelayMs: 0,
        })).rejects.toMatchObject({ status: 409, code: 'upload.offsetConflict' });

        expect(sent).toEqual([
            { offset: 0, text: 'abcd' },
            { offset: 4, text: 'efgh' },
        ]);
    });

    it('does not retry a cancelled upload', async () =>
    {
        const sent = fakeTransport(() =>
        {
            throw new DOMException('Upload cancelled', 'AbortError');
        });

        await expect(uploadChunked({
            ticket: 'TKT',
            file: fileOf('abcdefgh'),
            commit: COMMIT,
            chunkBytes: 4,
            retryDelayMs: 0,
        })).rejects.toMatchObject({ name: 'AbortError' });

        expect(sent).toHaveLength(1);
    });

    it('reports progress against the whole file: the bytes already delivered plus the chunk in flight', async () =>
    {
        const progress : number[] = [];

        uploadMock.mockImplementation(async (options : UploadWithProgressOptions) : Promise<UploadOutcome> =>
        {
            const length = options.body.size;
            options.onProgress?.({ sentBytes: length / 2, totalBytes: length });
            options.onProgress?.({ sentBytes: length, totalBytes: length });

            const offset = options.offset ?? 0;

            return offset + length >= 10 ? commits() : accepted({ offset, text: 'x'.repeat(length) });
        });

        await uploadChunked({
            ticket: 'TKT',
            file: fileOf('abcdefghij'),
            commit: COMMIT,
            chunkBytes: 4,
            onProgress: (update) =>
            {
                expect(update.totalBytes).toBe(10);
                progress.push(update.sentBytes);
            },
        });

        expect(progress).toEqual([ 2, 4, 6, 8, 9, 10 ]);
    });
});

//----------------------------------------------------------------------------------------------------------------------
