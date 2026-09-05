// @vitest-environment node

//----------------------------------------------------------------------------------------------------------------------
// File Byte Reads
//
// Runs in the node environment because jsdom's File has no .stream(); node's global File does, which is also what a
// real browser gives. Expected digests are the published SHA-256 test vectors (and node's own createHash for the
// streamed-in-chunks case), derived independently of the implementation.
//----------------------------------------------------------------------------------------------------------------------

import { createHash } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import { hashFile, readSampleWindows } from '@client/utils/hashFile.ts';

//----------------------------------------------------------------------------------------------------------------------

function fileOf(bytes : Uint8Array, name = 'blob.bin') : File
{
    return new File([ new Uint8Array(bytes) ], name);
}

//----------------------------------------------------------------------------------------------------------------------

describe('hashFile', () =>
{
    it('hashes "abc" to its known SHA-256 vector', async () =>
    {
        const digest = await hashFile(fileOf(new Uint8Array([ 0x61, 0x62, 0x63 ])));

        expect(digest).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    });

    it('hashes the empty file to the zero-byte digest', async () =>
    {
        const digest = await hashFile(fileOf(new Uint8Array(0)));

        expect(digest).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    });

    it('streams larger content to the same digest node computes over the whole buffer', async () =>
    {
        const bytes = new Uint8Array(200_000);
        for(let index = 0; index < bytes.length; index += 1) { bytes[index] = index % 251; }

        const digest = await hashFile(fileOf(bytes));

        const expected = createHash('sha256')
            .update(bytes)
            .digest('hex');
        expect(digest).toBe(expected);
    });

    it('reports progress that ends at the full byte count', async () =>
    {
        const bytes = new Uint8Array(50_000).fill(7);
        const onProgress = vi.fn();

        await hashFile(fileOf(bytes), onProgress);

        expect(onProgress).toHaveBeenCalled();
        const last = onProgress.mock.calls.at(-1)?.[0];
        expect(last).toEqual({ hashedBytes: 50_000, totalBytes: 50_000 });
    });

    it('throws when handed an already-aborted signal', async () =>
    {
        await expect(hashFile(fileOf(new Uint8Array([ 1, 2, 3 ])), undefined, AbortSignal.abort()))
            .rejects.toMatchObject({ name: 'AbortError' });
    });
});

//----------------------------------------------------------------------------------------------------------------------

describe('readSampleWindows', () =>
{
    it('returns the exact bytes at each window, in order', async () =>
    {
        const file = fileOf(new Uint8Array([ 0, 1, 2, 3, 4, 5, 6, 7, 8, 9 ]));

        const windows = await readSampleWindows(file, [ [ 0, 3 ], [ 5, 2 ] ]);

        expect(windows.map((buffer) => [ ...new Uint8Array(buffer) ])).toEqual([ [ 0, 1, 2 ], [ 5, 6 ] ]);
    });

    it('returns an empty list for no ranges', async () =>
    {
        const windows = await readSampleWindows(fileOf(new Uint8Array([ 1, 2, 3 ])), []);

        expect(windows).toEqual([]);
    });
});

//----------------------------------------------------------------------------------------------------------------------
