//----------------------------------------------------------------------------------------------------------------------
// Filesystem Blob Backend
//
// The `fs` backend: blobs live at root/ab/cd/<sha256>, sharded by the first two byte-pairs of the hash. A put streams
// to a staging file under the same root -- so committing is a same-filesystem rename, which is atomic -- while hashing
// and counting bytes; a claimed sha256 or size the bytes disagree with is rejected and the staging file removed, so a
// lying client can never poison the store. Nothing here ever buffers a whole blob: reads are ranged or streamed.
//----------------------------------------------------------------------------------------------------------------------

import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { type FileHandle, access, mkdir, open, rename, rm } from 'node:fs/promises';
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

function isNotFound(error : unknown) : boolean
{
    return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}

//----------------------------------------------------------------------------------------------------------------------

export class FsBackend implements BlobBackend
{
    #root : string;
    #staging : string;

    constructor(config : FsBackendConfig)
    {
        this.#root = resolveStorageRoot(config.root);
        this.#staging = join(this.#root, STAGING_DIR);
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

            const target = this.#blobPath(sha256);

            // Content-addressed: an existing file for this sha256 already holds byte-identical content, so skip the
            // commit rather than rewrite it. The staging file is still cleaned up in the finally.
            if(await this.#fileExists(target)) { return; }

            await mkdir(dirname(target), { recursive: true });
            await rename(stagingPath, target);
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
