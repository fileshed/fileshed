//----------------------------------------------------------------------------------------------------------------------
// Filesystem Blob Backend
//
// Exercises the fs backend against a real temp filesystem (per-test mkdtemp, zero mocks) because the whole contract is
// about bytes on disk: hash-sharded layout, integrity-checked commits, ranged reads. Content addressing means the
// address IS the sha256 of the bytes, so every expected value is hand-derived from the input, never read back from
// the code.
//----------------------------------------------------------------------------------------------------------------------

import { createHash, randomBytes } from 'node:crypto';
import { mkdir, mkdtemp, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

// Models
import {
    BlobNotFoundError,
    HashMismatchError,
    InvalidSha256Error,
    SizeMismatchError,
} from '@fileshed/core';

// Resource Access (under test)
import { FsBackend, resolveStorageRoot } from '@server/resource-access/blob/fsBackend.ts';

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
    it('stores bytes under the hash-sharded path and streams them back byte-for-byte', async () =>
    {
        const bytes = Buffer.from('content-addressed storage keeps one copy per hash');
        const sha256 = sha256Of(bytes);

        await store.put(sha256, streamOf(bytes), bytes.length);

        expect(await pathExists(shardPath(root, sha256))).toBe(true);
        expect(await collect(await store.getStream(sha256))).toEqual(bytes);
    });

    it('rejects a put whose bytes do not hash to the claimed sha256 and stores nothing', async () =>
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

    it('rejects a put whose byte count differs from the claimed size and stores nothing', async () =>
    {
        const bytes = Buffer.from('twenty-ish bytes here');
        const sha256 = sha256Of(bytes);

        await expect(store.put(sha256, streamOf(bytes), bytes.length + 1)).rejects.toBeInstanceOf(SizeMismatchError);

        expect(await pathExists(shardPath(root, sha256))).toBe(false);
        expect(await readdir(join(root, '.staging'))).toEqual([]);
    });

    it('returns exactly the requested window from both getStream(range) and read', async () =>
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

    it('reports existence before and after put, and delete removes the blob', async () =>
    {
        const bytes = Buffer.from('deletable');
        const sha256 = sha256Of(bytes);

        expect(await store.exists(sha256)).toBe(false);

        await store.put(sha256, streamOf(bytes), bytes.length);
        expect(await store.exists(sha256)).toBe(true);

        await store.delete(sha256);
        expect(await store.exists(sha256)).toBe(false);
    });

    it('treats delete of an absent blob as a no-op (GC may race an already-gone blob)', async () =>
    {
        const sha256 = sha256Of(Buffer.from('never stored'));

        await expect(store.delete(sha256)).resolves.toBeUndefined();
    });

    it('throws BlobNotFoundError when getStream or read target a blob that is not stored', async () =>
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

    it('rejects a malformed sha256 address instead of deriving a filesystem path', async () =>
    {
        // A traversal-shaped address must never reach the filesystem.
        await expect(store.exists('../../etc/passwd')).rejects.toBeInstanceOf(InvalidSha256Error);
        await expect(store.getStream('not-a-real-hash')).rejects.toBeInstanceOf(InvalidSha256Error);
    });
});

//----------------------------------------------------------------------------------------------------------------------
// Chunked uploads
//
// Staged bytes are not a blob until they are verified: the same integrity contract a put owes applies at the commit,
// and until then the bytes live nowhere addressable. The expectations are hand-derived from the chunks fed in -- the
// assembled file is the concatenation, and its address is the sha256 of that.
//----------------------------------------------------------------------------------------------------------------------

describe('FsBackend chunked uploads', () =>
{
    it('assembles chunks in order and publishes them at the address of the whole file', async () =>
    {
        const head = Buffer.from('the first half of the file, ');
        const tail = Buffer.from('and the second half of it');
        const whole = Buffer.concat([ head, tail ]);
        const sha256 = sha256Of(whole);

        await store.appendChunk('upload-1', streamOf(head), 0);
        await store.appendChunk('upload-1', streamOf(tail), head.length);
        await store.commitChunked('upload-1', sha256, whole.length);

        expect(await collect(await store.getStream(sha256))).toEqual(whole);
    });

    it('answers each append with the byte count it took', async () =>
    {
        const bytes = randomBytes(4096);

        expect(await store.appendChunk('upload-2', streamOf(bytes.subarray(0, 1000)), 0)).toBe(1000);
        expect(await store.appendChunk('upload-2', streamOf(bytes.subarray(1000)), 1000)).toBe(3096);
    });

    it('drops the bytes a torn chunk left behind when that chunk is sent again', async () =>
    {
        const head = Buffer.from('chunk one');
        const tail = Buffer.from('chunk two');
        const whole = Buffer.concat([ head, tail ]);
        const sha256 = sha256Of(whole);

        await store.appendChunk('upload-3', streamOf(head), 0);

        // The second chunk tore partway through, so the staging file runs past what the caller accepted. Its retry
        // starts from the same offset and must land the same bytes as if the tear never happened.
        await store.appendChunk('upload-3', streamOf(Buffer.from('chunk tw')), head.length);
        await store.appendChunk('upload-3', streamOf(tail), head.length);

        await store.commitChunked('upload-3', sha256, whole.length);

        expect(await collect(await store.getStream(sha256))).toEqual(whole);
    });

    it('refuses to publish staged bytes that do not hash to the claimed address, storing nothing', async () =>
    {
        const bytes = Buffer.from('what actually arrived');
        const claimed = sha256Of(Buffer.from('what the client said would arrive'));

        await store.appendChunk('upload-4', streamOf(bytes), 0);

        await expect(store.commitChunked('upload-4', claimed, bytes.length))
            .rejects
            .toBeInstanceOf(HashMismatchError);

        expect(await pathExists(shardPath(root, claimed))).toBe(false);
        expect(await readdir(join(root, '.partials'))).toEqual([]);
    });

    it('refuses to publish a staging file whose length differs from the claimed size, storing nothing', async () =>
    {
        const bytes = Buffer.from('nineteen bytes here');
        const sha256 = sha256Of(bytes);

        await store.appendChunk('upload-5', streamOf(bytes), 0);

        await expect(store.commitChunked('upload-5', sha256, bytes.length + 10))
            .rejects
            .toBeInstanceOf(SizeMismatchError);

        expect(await pathExists(shardPath(root, sha256))).toBe(false);
        expect(await readdir(join(root, '.partials'))).toEqual([]);
    });

    it('leaves nothing staged once an upload is published or discarded', async () =>
    {
        const bytes = Buffer.from('published bytes');

        await store.appendChunk('upload-6', streamOf(bytes), 0);
        await store.commitChunked('upload-6', sha256Of(bytes), bytes.length);

        await store.appendChunk('upload-7', streamOf(Buffer.from('abandoned bytes')), 0);
        await store.discardChunked('upload-7');

        expect(await readdir(join(root, '.partials'))).toEqual([]);
    });

    it('treats discarding an upload that staged nothing as a no-op', async () =>
    {
        await expect(store.discardChunked('upload-that-never-was')).resolves.toBeUndefined();
    });

    it('sweeps staging left by abandoned uploads and leaves the ones still being written', async () =>
    {
        const staged = Buffer.from('abandoned mid-upload');
        await store.appendChunk('upload-8', streamOf(staged), 0);

        // Nothing has aged past a cutoff in the past, so a sweep with one reclaims nothing and counts no candidate.
        expect(await store.sweepChunked(new Date(Date.now() - 60_000)))
            .toEqual({ candidates: 0, reclaimed: 0, failed: 0, bytesFreed: 0 });
        expect(await readdir(join(root, '.partials'))).toHaveLength(1);

        expect(await store.sweepChunked(new Date(Date.now() + 60_000)))
            .toEqual({ candidates: 1, reclaimed: 1, failed: 0, bytesFreed: staged.length });
        expect(await readdir(join(root, '.partials'))).toEqual([]);
    });

    it('sweeps a store where no chunked upload ever ran without complaining', async () =>
    {
        expect(await store.sweepChunked(new Date()))
            .toEqual({ candidates: 0, reclaimed: 0, failed: 0, bytesFreed: 0 });
    });

    it('keeps one upload\'s staged bytes out of another\'s', async () =>
    {
        const mine = Buffer.from('my file');
        const yours = Buffer.from('your file');

        await store.appendChunk('upload-9', streamOf(mine), 0);
        await store.appendChunk('upload-10', streamOf(yours), 0);

        await store.commitChunked('upload-9', sha256Of(mine), mine.length);
        await store.commitChunked('upload-10', sha256Of(yours), yours.length);

        expect(await collect(await store.getStream(sha256Of(mine)))).toEqual(mine);
        expect(await collect(await store.getStream(sha256Of(yours)))).toEqual(yours);
    });
});

//----------------------------------------------------------------------------------------------------------------------

// Reconciling a store against its records means walking what is actually there. What the walk yields decides what
// something above may collect, so it answers for stored blobs and for nothing else.
describe('FsBackend reconciliation', () =>
{
    async function storedAddresses() : Promise<string[]>
    {
        const addresses : string[] = [];
        for await (const address of store.listStored()) { addresses.push(address); }

        return addresses.sort();
    }

    it('lists every stored blob', async () =>
    {
        const first = Buffer.from('one');
        const second = Buffer.from('two');

        await store.put(sha256Of(first), streamOf(first), first.length);
        await store.put(sha256Of(second), streamOf(second), second.length);

        expect(await storedAddresses()).toEqual([ sha256Of(first), sha256Of(second) ].sort());
    });

    // Staging areas are not blobs and are somebody else's to reclaim; a directory that is not a shard is not part of
    // the tree at all. Yielding either would hand a caller an address for bytes it has no business collecting.
    it('lists nothing for staged uploads or files that are not blobs', async () =>
    {
        const staged = Buffer.from('half an upload');
        await store.appendChunk('upload-listed', streamOf(staged), 0);

        await mkdir(join(root, 'zz', 'zz'), { recursive: true });
        await writeFile(join(root, 'zz', 'zz', 'not-a-blob'), 'text');
        await writeFile(join(root, 'loose.txt'), 'text');

        expect(await storedAddresses()).toEqual([]);
    });

    it('measures a stored blob, and answers nothing for an address it does not hold', async () =>
    {
        const data = randomBytes(512);
        const before = Date.now();

        await store.put(sha256Of(data), streamOf(data), data.length);
        const stored = await store.statStored(sha256Of(data));

        expect(stored?.size).toBe(data.length);
        expect(stored?.modifiedAt.getTime()).toBeGreaterThanOrEqual(before - 1000);

        expect(await store.statStored(sha256Of(Buffer.from('never stored')))).toBeNull();
    });

    it('refuses to measure a malformed address', async () =>
    {
        await expect(store.statStored('../../etc/passwd')).rejects.toBeInstanceOf(InvalidSha256Error);
    });
});

//----------------------------------------------------------------------------------------------------------------------

describe('resolveStorageRoot', () =>
{
    // A relative root must mean the same directory from every entry point -- the Vite dev server (cwd src/client)
    // and the standalone server (cwd repo root) share one blob store. Anchoring to the repo root, derived from the
    // module's own location, is what makes the result cwd-independent.
    it('anchors a relative root to the repo root, independent of the working directory', () =>
    {
        const resolved = resolveStorageRoot('./data/blobs');

        // This spec sits four directories below the repo root too, so the expectation derives its own anchor.
        const repoRoot = fileURLToPath(new URL('../../../..', import.meta.url));
        expect(resolved).toBe(join(repoRoot, 'data/blobs'));
    });

    it('passes an absolute root through untouched', () =>
    {
        expect(resolveStorageRoot('/var/lib/fileshed/blobs')).toBe('/var/lib/fileshed/blobs');
    });
});

//----------------------------------------------------------------------------------------------------------------------
