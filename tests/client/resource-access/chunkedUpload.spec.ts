//----------------------------------------------------------------------------------------------------------------------
// Chunked Upload
//
// Drives the sequencing against a fake transport that records every request and decides each outcome, so the specs
// assert the requests the uploader actually makes -- which bytes went, at which offset, in which order, and how often
// after a failure. The chunk plan runs for real; only the wire is faked.
//----------------------------------------------------------------------------------------------------------------------

import { type Mock, beforeEach, describe, expect, it, vi } from 'vitest';

import type { NodeResponse } from '@fileshed/core';

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

function accepted() : UploadOutcome
{
    return { committed: false, receivedBytes: 0, totalBytes: 0 };
}

function commits() : UploadOutcome
{
    return { committed: true, node: committedNode() };
}

// A transport that records every request and answers each the way the spec's script says, taking the bytes and waiting
// for more unless told otherwise.
function fakeTransport(script : ChunkScript = accepted) : SentChunk[]
{
    const sent : SentChunk[] = [];
    let calls = 0;

    uploadMock.mockImplementation(async (options : UploadWithProgressOptions) : Promise<UploadOutcome> =>
    {
        calls += 1;
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
        return chunk.offset === offset ? commits() : accepted();
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

    it('re-sends only the failed chunk, leaving the chunks already accepted alone', async () =>
    {
        const sent = fakeTransport((chunk, call) =>
        {
            if(chunk.offset === 4 && call === 2) { throw new ApiError(0, 'The upload could not reach the server.'); }

            return chunk.offset === 8 ? commits() : accepted();
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

    it('gives up on a chunk after its attempt budget and surfaces the failure', async () =>
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

            return chunk.offset === 8 ? commits() : accepted();
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

    it('gives up on a chunk the upload never stops receiving, within the same attempt budget', async () =>
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
            maxAttempts: 3,
            retryDelayMs: 0,
        })).rejects.toMatchObject({ status: 409, code: 'upload.chunkInFlight' });

        expect(sent).toHaveLength(3);
    });

    // The other 409: the server and the client disagree about where the upload stands. Sending the same bytes again
    // asks the same question and gets the same answer, so it surfaces instead.
    it('does not retry a chunk the server says does not belong where it was sent', async () =>
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

            return (options.offset ?? 0) + length >= 10 ? commits() : accepted();
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
