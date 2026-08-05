//----------------------------------------------------------------------------------------------------------------------
// Filesystem Blob Backend
//
// The `fs` backend: blobs live at root/ab/cd/<sha256>, sharded by the first two byte-pairs of the hash. A put streams
// to a staging file under the same root -- so committing is a same-filesystem rename, which is atomic -- while hashing
// and counting bytes; a claimed sha256 or size the bytes disagree with is rejected and the staging file removed, so a
// lying client can never poison the store. A chunked upload stages the same way, one append per chunk, and is hashed
// in a single pass when the last byte lands. Nothing here ever buffers a whole blob: reads are ranged or streamed.
//----------------------------------------------------------------------------------------------------------------------

import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { type FileHandle, access, mkdir, open, readdir, rename, rm, stat, truncate } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { type Readable, Transform, type TransformCallback } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

import { z } from 'zod';

// Models
import { BlobNotFoundError, HashMismatchError, InvalidSha256Error, SizeMismatchError } from '@fileshed/core';

// Resource Access
import type { BlobBackend, BlobRange } from '../interfaces/blob.ts';

//----------------------------------------------------------------------------------------------------------------------
// Config
//
// The backend validates its own config out of the storage_backend row's opaque config JSON (the StorageBackend model
// keeps that shape backend-specific). `root` is the directory the blob tree and its staging area live under.
//----------------------------------------------------------------------------------------------------------------------

export const fsBackendConfigCodec = z.strictObject({
    root: z.string().min(1),
});

export type FsBackendConfig = z.infer<typeof fsBackendConfigCodec>;

export function parseFsBackendConfig(config : unknown) : FsBackendConfig
{
    return fsBackendConfigCodec.parse(config);
}

// A relative root resolves against the REPO ROOT, not process.cwd() -- the Vite dev server runs with src/client as
// its cwd while the standalone entry runs at the root, and cwd-relative resolution silently splits the blob store
// across two directories (the same asymmetry database.ts resolves for DATABASE_PATH). This file sits four
// directories below the root.
export function resolveStorageRoot(root : string) : string
{
    const repoRoot = fileURLToPath(new URL('../../../..', import.meta.url));
    return isAbsolute(root) ? root : resolve(repoRoot, root);
}

//----------------------------------------------------------------------------------------------------------------------

// A canonical, lowercase sha256 hex digest. Enforcing the form keeps the same blob from landing under two shard
// paths and stops a crafted address from escaping the root via path traversal.
const SHA256_PATTERN = /^[0-9a-f]{64}$/;

// The staging directory lives under root (not a sibling) so a committed blob is always a rename within one filesystem.
const STAGING_DIR = '.staging';

// Chunked uploads stage in their own directory, so the sweep that reclaims abandoned partials never has to tell them
// apart from the short-lived staging file a put holds open.
const PARTIALS_DIR = '.partials';

function isNotFound(error : unknown) : boolean
{
    return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}

//----------------------------------------------------------------------------------------------------------------------

export class FsBackend implements BlobBackend
{
    #root : string;
    #staging : string;
    #partials : string;

    constructor(config : FsBackendConfig)
    {
        this.#root = resolveStorageRoot(config.root);
        this.#staging = join(this.#root, STAGING_DIR);
        this.#partials = join(this.#root, PARTIALS_DIR);
    }

    async exists(sha256 : string) : Promise<boolean>
    {
        this.#assertSha256(sha256);
        return this.#fileExists(this.#blobPath(sha256));
    }

    async put(sha256 : string, stream : Readable, size : number) : Promise<void>
    {
        this.#assertSha256(sha256);
        await mkdir(this.#staging, { recursive: true });

        const stagingPath = join(this.#staging, randomUUID());
        const hash = createHash('sha256');
        let observed = 0;

        const meter = new Transform({
            transform(chunk : Buffer, _encoding : BufferEncoding, callback : TransformCallback) : void
            {
                hash.update(chunk);
                observed += chunk.length;
                callback(null, chunk);
            },
        });

        try
        {
            await pipeline(stream, meter, createWriteStream(stagingPath));

            if(observed !== size)
            {
                throw new SizeMismatchError(sha256, size, observed);
            }

            const digest = hash.digest('hex');
            if(digest !== sha256)
            {
                throw new HashMismatchError(sha256, digest);
            }

            await this.#publish(stagingPath, sha256);
        }
        finally
        {
            await rm(stagingPath, { force: true });
        }
    }

    async getStream(sha256 : string, range ?: BlobRange) : Promise<Readable>
    {
        this.#assertSha256(sha256);

        const path = this.#blobPath(sha256);
        if(!(await this.#fileExists(path)))
        {
            throw new BlobNotFoundError(sha256);
        }

        if(range)
        {
            // createReadStream's end is inclusive.
            return createReadStream(path, { start: range.offset, end: range.offset + range.length - 1 });
        }

        return createReadStream(path);
    }

    async read(sha256 : string, offset : number, length : number) : Promise<Buffer>
    {
        this.#assertSha256(sha256);

        let handle : FileHandle;
        try
        {
            handle = await open(this.#blobPath(sha256), 'r');
        }
        catch(error)
        {
            if(isNotFound(error)) { throw new BlobNotFoundError(sha256); }
            throw error;
        }

        try
        {
            const buffer = Buffer.alloc(length);
            const { bytesRead } = await handle.read(buffer, 0, length, offset);
            return bytesRead === length ? buffer : buffer.subarray(0, bytesRead);
        }
        finally
        {
            await handle.close();
        }
    }

    async delete(sha256 : string) : Promise<void>
    {
        this.#assertSha256(sha256);

        // Idempotent: deleting an absent blob is a no-op. GC may race a blob already gone, and force ignores it.
        await rm(this.#blobPath(sha256), { force: true });
    }

    //------------------------------------------------------------------------------------------------------------------
    // Chunked uploads
    //------------------------------------------------------------------------------------------------------------------

    async appendChunk(uploadID : string, stream : Readable, offset : number) : Promise<number>
    {
        await mkdir(this.#partials, { recursive: true });

        const path = this.#partialPath(uploadID);
        await this.#alignTo(path, offset);

        let written = 0;
        const meter = new Transform({
            transform(chunk : Buffer, _encoding : BufferEncoding, callback : TransformCallback) : void
            {
                written += chunk.length;
                callback(null, chunk);
            },
        });

        await pipeline(stream, meter, createWriteStream(path, { flags: 'a' }));

        return written;
    }

    // Hash the staged bytes in one pass and publish them. The read pass is the price of not carrying hash state across
    // requests: state cannot be rewound, so a chunk that tore halfway through would leave the running hash ahead of
    // the bytes on disk with no way back, while a length is always exact.
    async commitChunked(uploadID : string, sha256 : string, size : number) : Promise<void>
    {
        this.#assertSha256(sha256);

        const path = this.#partialPath(uploadID);

        try
        {
            const staged = await this.#sizeOf(path);
            if(staged !== size)
            {
                throw new SizeMismatchError(sha256, size, staged);
            }

            const digest = await this.#digestOf(path);
            if(digest !== sha256)
            {
                throw new HashMismatchError(sha256, digest);
            }

            await this.#publish(path, sha256);
        }
        finally
        {
            await rm(path, { force: true });
        }
    }

    async discardChunked(uploadID : string) : Promise<void>
    {
        await rm(this.#partialPath(uploadID), { force: true });
    }

    async sweepChunked(cutoff : Date) : Promise<number>
    {
        const names = await readdir(this.#partials).catch(() => [] as string[]);

        const swept = await Promise.all(names.map(async (name) =>
        {
            const path = join(this.#partials, name);

            const stats = await stat(path).catch(() => null);
            if(stats === null || stats.mtimeMs >= cutoff.getTime()) { return false; }

            await rm(path, { force: true });
            return true;
        }));

        return swept.filter(Boolean).length;
    }

    #assertSha256(sha256 : string) : void
    {
        if(!SHA256_PATTERN.test(sha256))
        {
            throw new InvalidSha256Error(sha256);
        }
    }

    #blobPath(sha256 : string) : string
    {
        return join(this.#root, sha256.slice(0, 2), sha256.slice(2, 4), sha256);
    }

    // The staging file for an upload. The id is hashed rather than used as a filename, so no id -- however it was
    // minted -- can steer the path anywhere but into the partials directory.
    #partialPath(uploadID : string) : string
    {
        return join(this.#partials, createHash('sha256')
            .update(uploadID)
            .digest('hex'));
    }

    // Move verified staged bytes to their address. Content-addressed: an existing file for this sha256 already holds
    // byte-identical content, so the rename is skipped rather than rewriting it; the caller cleans up the staging file
    // either way.
    async #publish(stagingPath : string, sha256 : string) : Promise<void>
    {
        const target = this.#blobPath(sha256);
        if(await this.#fileExists(target)) { return; }

        await mkdir(dirname(target), { recursive: true });
        await rename(stagingPath, target);
    }

    // Cut the staging file back to where the caller believes it ends, which is how a torn append heals: the bytes a
    // failed chunk managed to write are dropped before its retry adds them again.
    async #alignTo(path : string, offset : number) : Promise<void>
    {
        const staged = await this.#sizeOf(path);
        if(staged === offset) { return; }

        if(staged < offset)
        {
            throw new Error(`upload staging holds ${ staged } bytes, short of the ${ offset } already accepted`);
        }

        await truncate(path, offset);
    }

    async #sizeOf(path : string) : Promise<number>
    {
        const stats = await stat(path).catch((error : unknown) =>
        {
            if(isNotFound(error)) { return null; }
            throw error;
        });

        return stats?.size ?? 0;
    }

    async #digestOf(path : string) : Promise<string>
    {
        const hash = createHash('sha256');
        await pipeline(createReadStream(path), hash);

        return hash.digest('hex');
    }

    async #fileExists(path : string) : Promise<boolean>
    {
        try
        {
            await access(path);
            return true;
        }
        catch
        {
            return false;
        }
    }
}

//----------------------------------------------------------------------------------------------------------------------
