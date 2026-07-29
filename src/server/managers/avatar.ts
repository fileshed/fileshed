//----------------------------------------------------------------------------------------------------------------------
// Avatar Manager
//
// The lifecycle of a user's avatar: upload (store bytes, point the user at them, graveyard the one they replaced),
// delete (drop the reference, graveyard the orphan), and serve (bytes for a hash, but ONLY one an avatar references).
//
// Avatars share the content-addressed blob store with file content but never a node, so they charge no quota and carry
// their mime on the user row. Upload has no claim/proof-of-possession dance: there is no client-supplied hash to
// prove, so the server hashes the bytes it receives and stores them content-addressed. The reference move and the old
// blob's graveyard-check run in one transaction, mirroring a content replace -- the sweep re-derives each blob's
// reference count, so a hash still referenced by another user's avatar or any file node survives.
//----------------------------------------------------------------------------------------------------------------------

import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';

// Models
import { type AvatarMimeType, BadRequestError, PayloadTooLargeError, avatarMimeTypes } from '@fileshed/core';

// Resource Access
import { BlobRA } from '../resource-access/blob/index.ts';
import type { DatabaseHandle } from '../resource-access/database/database.ts';
import { UserRA } from '../resource-access/users/index.ts';

// Utils
import { collectCapped, mediaType } from '../utils/uploadBody.ts';

//----------------------------------------------------------------------------------------------------------------------

export interface AvatarManagerDeps
{
    handle : DatabaseHandle;
    blob : BlobRA;

    // Read at use time, per request, so an admin raising or lowering the cap needs no restart.
    avatarMaxBytes : () => Promise<number>;
}

// The bytes and metadata to serve for a GET, or null when the hash is not any user's avatar (the serve gate).
export interface ServedAvatar
{
    stream : Readable;
    mime : string;
    size : number;
}

//----------------------------------------------------------------------------------------------------------------------

function isAvatarMime(value : string | null) : value is AvatarMimeType
{
    return value !== null && (avatarMimeTypes as readonly string[]).includes(value);
}

//----------------------------------------------------------------------------------------------------------------------

export class AvatarManager
{
    readonly #handle : DatabaseHandle;
    readonly #blob : BlobRA;
    readonly #users : UserRA;
    readonly #maxBytes : () => Promise<number>;

    constructor(deps : AvatarManagerDeps)
    {
        this.#handle = deps.handle;
        this.#blob = deps.blob;
        this.#users = new UserRA(deps.handle);
        this.#maxBytes = deps.avatarMaxBytes;
    }

    // Store an uploaded avatar and point the caller at it. The mime is validated against the whitelist and the bytes
    // against the byte cap before anything is written; the bytes are hashed and stored content-addressed, then the user
    // row is repointed and the blob they replaced (if any, and if now unreferenced) is graveyarded -- all in one
    // transaction, so a crash never leaves the row and the graveyard disagreeing.
    async setAvatar(
        userID : string,
        source : Readable,
        contentType : string | undefined,
        declaredLength : number | undefined
    ) : Promise<void>
    {
        const media = mediaType(contentType);
        if(!isAvatarMime(media))
        {
            throw new BadRequestError('Avatar must be a PNG, JPEG, WebP, GIF, or BMP image.');
        }

        // Resolved once, so the declared-length check and the streaming cap judge the same request by the same number.
        const maxBytes = await this.#maxBytes();

        if(declaredLength !== undefined && declaredLength > maxBytes)
        {
            throw new PayloadTooLargeError('Avatar exceeds the maximum size.');
        }

        const bytes = await collectCapped(source, maxBytes, 'Avatar exceeds the maximum size.');
        const sha256 = createHash('sha256')
            .update(bytes)
            .digest('hex');

        // Bytes first, outside the transaction (the store verifies them against the hash while writing); the record and
        // the reference move commit together below. GC never touches a live record, so this ordering strands nothing.
        const location = await this.#blob.put(sha256, Readable.from(bytes), bytes.length);

        await this.#handle.db.transaction().execute(async (trx) =>
        {
            const txHandle : DatabaseHandle = { db: trx, kind: this.#handle.kind };
            const blob = new BlobRA(txHandle);
            const users = new UserRA(txHandle);

            const oldSha256 = await users.avatarSha256Of(userID);

            await blob.insertOrResurrect({
                sha256,
                size: bytes.length,
                backendID: location.backendID,
                storageKey: location.storageKey,
            });
            await users.setAvatar(userID, sha256, media);

            // Graveyard the replaced blob once the reference has moved off it. Skipped when the avatar is unchanged
            // (the row still points at the same hash, so the sweep would find it referenced anyway).
            if(oldSha256 !== null && oldSha256 !== sha256)
            {
                await blob.graveyardUnreferenced([ oldSha256 ], trx);
            }
        });
    }

    // Drop the caller's avatar and graveyard the blob they held (when nothing else references it). Idempotent: an
    // account with no avatar clears nothing and graveyards nothing.
    async deleteAvatar(userID : string) : Promise<void>
    {
        await this.#handle.db.transaction().execute(async (trx) =>
        {
            const txHandle : DatabaseHandle = { db: trx, kind: this.#handle.kind };
            const blob = new BlobRA(txHandle);
            const users = new UserRA(txHandle);

            const oldSha256 = await users.avatarSha256Of(userID);
            if(oldSha256 === null) { return; }

            await users.clearAvatar(userID);
            await blob.graveyardUnreferenced([ oldSha256 ], trx);
        });
    }

    // The bytes to serve for an avatar hash, or null when NO user's avatar references it. The reference check is the
    // security gate: the dedup store holds private file content by hash, so serving a hash no avatar points at would
    // turn this route into an oracle for exfiltrating any blob by its hash.
    async serveAvatar(sha256 : string) : Promise<ServedAvatar | null>
    {
        const mime = await this.#users.avatarMimeForSha(sha256);
        if(mime === null) { return null; }

        const row = await this.#blob.get(sha256);
        if(row === undefined) { return null; }

        const stream = await this.#blob.getStream({ backendID: row.backendID, storageKey: row.storageKey });
        return { stream, mime, size: row.size };
    }
}

//----------------------------------------------------------------------------------------------------------------------
