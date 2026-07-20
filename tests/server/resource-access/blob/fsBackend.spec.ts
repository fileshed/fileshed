//----------------------------------------------------------------------------------------------------------------------
// Filesystem Blob Backend
//
// Exercises the fs backend against a real temp filesystem (per-test mkdtemp, zero mocks) because the whole contract is
// about bytes on disk: hash-sharded layout, integrity-checked commits, ranged reads. Expectations come from
// requirements.md secs 4.1/4.3 -- content addressing means the address IS the sha256 of the bytes, so every expected
// value is hand-derived from the input, never read back from the code.
//----------------------------------------------------------------------------------------------------------------------

import { createHash, randomBytes } from 'node:crypto';
import { mkdtemp, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

// Models
import {
    BlobNotFoundError,
    HashMismatchError,
    InvalidSha256Error,
    SizeMismatchError,
} from '@fileshed/core';

// Resource Access (under test)
import { FsBackend } from '@server/resource-access/blob/fsBackend.ts';

//----------------------------------------------------------------------------------------------------------------------
// Helpers
//----------------------------------------------------------------------------------------------------------------------

function sha256Of(data : Buffer) : string
{
    return createHash('sha256')
        .update(data)
        .digest('hex');
}

function streamOf(...chunks : Buffer[]) : Readable
{
    return Readable.from(chunks);
}

async function collect(stream : Readable) : Promise<Buffer>
{
    const chunks : Buffer[] = [];
    for await (const chunk of stream)
    {
        chunks.push(chunk as Buffer);
    }
    return Buffer.concat(chunks);
}

async function pathExists(path : string) : Promise<boolean>
{
    try
    {
        await stat(path);
        return true;
    }
    catch
    {
        return false;
    }
}

function shardPath(root : string, sha256 : string) : string
{
    return join(root, sha256.slice(0, 2), sha256.slice(2, 4), sha256);
}

//----------------------------------------------------------------------------------------------------------------------

let root : string;
let store : FsBackend;

beforeEach(async () =>
{
    root = await mkdtemp(join(tmpdir(), 'fileshed-blobs-'));
    store = new FsBackend({ root });
});

afterEach(async () =>
{
    await rm(root, { recursive: true, force: true });
});

//----------------------------------------------------------------------------------------------------------------------

describe('FsBackend', () =>
{
    it('stores bytes under the hash-sharded path and streams them back byte-for-byte (sec 4.1)', async () =>
    {
        const bytes = Buffer.from('content-addressed storage keeps one copy per hash');
        const sha256 = sha256Of(bytes);

        await store.put(sha256, streamOf(bytes), bytes.length);

        expect(await pathExists(shardPath(root, sha256))).toBe(true);
        expect(await collect(await store.getStream(sha256))).toEqual(bytes);
    });

    it('rejects a put whose bytes do not hash to the claimed sha256 and stores nothing (sec 4.3)', async () =>
    {
        const bytes = Buffer.from('the real payload');
        const claimed = sha256Of(Buffer.from('a different payload the client is lying about'));

        await expect(store.put(claimed, streamOf(bytes), bytes.length)).rejects.toBeInstanceOf(HashMismatchError);

        // No blob file, and the shard directory was never created -- the commit is reached only after verification.
        expect(await pathExists(shardPath(root, claimed))).toBe(false);
        expect(await pathExists(join(root, claimed.slice(0, 2), claimed.slice(2, 4)))).toBe(false);

        // The staging area holds no orphaned temp file.
        expect(await readdir(join(root, '.staging'))).toEqual([]);
    });

    it('rejects a put whose byte count differs from the claimed size and stores nothing (sec 4.3)', async () =>
    {
        const bytes = Buffer.from('twenty-ish bytes here');
        const sha256 = sha256Of(bytes);

        await expect(store.put(sha256, streamOf(bytes), bytes.length + 1)).rejects.toBeInstanceOf(SizeMismatchError);

        expect(await pathExists(shardPath(root, sha256))).toBe(false);
        expect(await readdir(join(root, '.staging'))).toEqual([]);
    });

    it('returns exactly the requested window from both getStream(range) and read (sec 4.1 ranged reads)', async () =>
    {
        const bytes = randomBytes(1000);
        const sha256 = sha256Of(bytes);
        const offset = 100;
        const length = 50;
        const expected = bytes.subarray(offset, offset + length);

        await store.put(sha256, streamOf(bytes), bytes.length);

        const ranged = await collect(await store.getStream(sha256, { offset, length }));
        const window = await store.read(sha256, offset, length);

        expect(ranged).toEqual(expected);
        expect(window).toEqual(expected);
    });

    it('reports existence before and after put, and delete removes the blob (secs 4.1/4.2)', async () =>
    {
        const bytes = Buffer.from('deletable');
        const sha256 = sha256Of(bytes);

        expect(await store.exists(sha256)).toBe(false);

        await store.put(sha256, streamOf(bytes), bytes.length);
        expect(await store.exists(sha256)).toBe(true);

        await store.delete(sha256);
        expect(await store.exists(sha256)).toBe(false);
    });

    it('treats delete of an absent blob as a no-op (sec 4.2 GC may race an already-gone blob)', async () =>
    {
        const sha256 = sha256Of(Buffer.from('never stored'));

        await expect(store.delete(sha256)).resolves.toBeUndefined();
    });

    it('throws BlobNotFoundError when getStream or read target a blob that is not stored (sec 4.1)', async () =>
    {
        const sha256 = sha256Of(Buffer.from('absent'));

        await expect(store.getStream(sha256)).rejects.toBeInstanceOf(BlobNotFoundError);
        await expect(store.read(sha256, 0, 16)).rejects.toBeInstanceOf(BlobNotFoundError);
    });

    it('round-trips a multi-megabyte blob delivered as many chunks (streams, never buffers)', async () =>
    {
        const chunks = Array.from({ length: 16 }, () => randomBytes(256 * 1024));
        const bytes = Buffer.concat(chunks);
        const sha256 = sha256Of(bytes);

        await store.put(sha256, streamOf(...chunks), bytes.length);

        const roundTripped = await collect(await store.getStream(sha256));

        expect(roundTripped.length).toBe(bytes.length);
        expect(roundTripped.equals(bytes)).toBe(true);
    });

    it('rejects a malformed sha256 address instead of deriving a filesystem path (sec 4.3)', async () =>
    {
        // A traversal-shaped address must never reach the filesystem.
        await expect(store.exists('../../etc/passwd')).rejects.toBeInstanceOf(InvalidSha256Error);
        await expect(store.getStream('not-a-real-hash')).rejects.toBeInstanceOf(InvalidSha256Error);
    });
});

//----------------------------------------------------------------------------------------------------------------------
