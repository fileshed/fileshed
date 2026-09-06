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
import { type Dirent, createReadStream, createWriteStream } from 'node:fs';
import { type FileHandle, access, mkdir, open, readdir, rename, rm, stat, truncate } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { type Readable, Transform, type TransformCallback } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

import { z } from 'zod';

// Models
import {
    BlobNotFoundError,
    HashMismatchError,
    InvalidSha256Error,
    OffsetConflictError,
    SizeMismatchError,
} from '@fileshed/core';

// Resource Access
import type { BlobBackend, BlobRange, StagedSweep, StoredBlobStat } from '../interfaces/blob.ts';

// Utils
import { getLogger } from '../../utils/logger.ts';

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

const logger = getLogger('fs-backend');

// A canonical, lowercase sha256 hex digest. Enforcing the form keeps the same blob from landing under two shard
// paths and stops a crafted address from escaping the root via path traversal.
const SHA256_PATTERN = /^[0-9a-f]{64}$/;

// One level of the sharded tree: the first or second byte-pair of a digest, in the same canonical form.
const SHARD_PATTERN = /^[0-9a-f]{2}$/;

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
    // Reconciliation
    //------------------------------------------------------------------------------------------------------------------

    // Walk the sharded tree one directory at a time, yielding only files that sit at the address their own name gives
    // them. The staging and partials directories are not shards and never match; anything else under the root -- an
    // operator's stray file, a directory a future backend keeps -- is left alone rather than reported as a blob
    // somebody might collect.
    async *listStored() : AsyncIterable<string>
    {
        for(const shard of await this.#shardNames(this.#root))
        {
            // eslint-disable-next-line no-await-in-loop -- a directory at a time is the point: the walk stays bounded
            for(const sub of await this.#shardNames(join(this.#root, shard)))
            {
                // eslint-disable-next-line no-await-in-loop -- likewise
                const names = await readdir(join(this.#root, shard, sub)).catch(() => [] as string[]);

                yield *names.filter((name) => SHA256_PATTERN.test(name) && name.startsWith(shard + sub));
            }
        }
    }

    async statStored(sha256 : string) : Promise<StoredBlobStat | null>
    {
        this.#assertSha256(sha256);

        const stats = await stat(this.#blobPath(sha256)).catch((error : unknown) =>
        {
            if(isNotFound(error)) { return null; }
            throw error;
        });

        return stats === null ? null : { size: stats.size, modifiedAt: stats.mtime };
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

    // A staging file already gone by the time it is measured -- committed, discarded, or taken by another server's
    // sweep -- is no candidate: nothing to reclaim, nothing to report. One that goes in the window between being
    // measured and being deleted is still counted here, since the delete is forced and cannot tell the difference,
    // so two servers sweeping at once can each bill themselves for the same bytes. That costs an overstated readout
    // and nothing else. One that will not delete is counted and logged rather than thrown, so a single unreadable
    // file cannot strand every other abandoned upload's bytes.
    async sweepChunked(cutoff : Date) : Promise<StagedSweep>
    {
        const names = await readdir(this.#partials).catch(() => [] as string[]);

        const outcomes = await Promise.all(names.map(async (name) =>
        {
            const path = join(this.#partials, name);

            const stats = await stat(path).catch(() => null);
            if(stats === null || stats.mtimeMs >= cutoff.getTime()) { return null; }

            try
            {
                await rm(path, { force: true });
                return { reclaimed: true, bytes: stats.size };
            }
            catch(error)
            {
                logger.error({ err: error, path }, 'Abandoned upload staging would not delete; bytes leaked');
                return { reclaimed: false, bytes: 0 };
            }
        }));

        const candidates = outcomes.filter((outcome) => outcome !== null);
        const reclaimed = candidates.filter((outcome) => outcome.reclaimed);

        return {
            candidates: candidates.length,
            reclaimed: reclaimed.length,
            failed: candidates.length - reclaimed.length,
            bytesFreed: reclaimed.reduce((total, outcome) => total + outcome.bytes, 0),
        };
    }

    // The shard directories inside a directory: two lowercase hex characters, nothing else. A root that does not exist
    // yet has no shards rather than being an error -- a store nobody has written to holds no blobs.
    async #shardNames(dir : string) : Promise<string[]>
    {
        const entries = await readdir(dir, { withFileTypes: true }).catch(() => [] as Dirent[]);

        return entries
            .filter((entry) => entry.isDirectory() && SHARD_PATTERN.test(entry.name))
            .map((entry) => entry.name);
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

        // The bytes this upload counted on are not there -- staging was reclaimed, or never held them. That is a
        // disagreement about where the upload stands, which is what the offset conflict says, and it travels with the
        // count staging actually holds rather than the one the caller believed.
        if(staged < offset)
        {
            throw new OffsetConflictError(
                `The upload holds ${ staged } bytes, short of the ${ offset } this chunk continues from.`,
                staged
            );
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
