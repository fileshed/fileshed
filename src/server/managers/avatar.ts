//----------------------------------------------------------------------------------------------------------------------
// Avatar Manager
//
// Upload has no claim/proof-of-possession dance: there is no client-supplied hash to prove, so the server hashes the
// bytes it receives. A hash still referenced by another user's avatar or any file node survives a replace, because the
// graveyard re-derives each blob's reference count.
//----------------------------------------------------------------------------------------------------------------------

import type { Readable } from 'node:stream';

// Models
import { NotFoundError, avatarMimeTypes } from '@fileshed/core';

// Managers
import { ReferencedImages, type ServedImage } from './referencedImages.ts';

// Resource Access
import type { BlobRA } from '../resource-access/blob/index.ts';
import type { DatabaseHandle } from '../resource-access/database/database.ts';
import { UserRA } from '../resource-access/users/index.ts';

//----------------------------------------------------------------------------------------------------------------------

export interface AvatarManagerDeps
{
    handle : DatabaseHandle;
    blob : BlobRA;

    // Read at use time, per request, so an admin raising or lowering the cap needs no restart.
    avatarMaxBytes : () => Promise<number>;
}

//----------------------------------------------------------------------------------------------------------------------

export class AvatarManager
{
    readonly #images : ReferencedImages;
    readonly #users : UserRA;
    readonly #maxBytes : () => Promise<number>;

    constructor(deps : AvatarManagerDeps)
    {
        this.#images = new ReferencedImages(deps.handle, deps.blob);
        this.#users = new UserRA(deps.handle);
        this.#maxBytes = deps.avatarMaxBytes;
    }

    // Store an uploaded avatar and point the caller at it, graveyarding the one it replaced.
    async setAvatar(
        userID : string,
        source : Readable,
        mediaType : string | null,
        declaredLength : number | undefined
    ) : Promise<void>
    {
        const rules = {
            accepts: avatarMimeTypes,
            maxBytes: await this.#maxBytes(),
            notAccepted: 'Avatar must be a PNG, JPEG, WebP, GIF, or BMP image.',
            tooLarge: 'Avatar exceeds the maximum size.',
        };

        await this.#images.store({ source, mediaType, declaredLength }, rules, async (image, tx) =>
        {
            const users = new UserRA(tx);
            const replaced = await users.avatarSha256Of(userID);

            await users.setAvatar(userID, image.sha256, image.media);

            return replaced;
        });
    }

    // Idempotent: an account with no avatar clears nothing and graveyards nothing.
    async deleteAvatar(userID : string) : Promise<void>
    {
        await this.#images.clear(async (tx) =>
        {
            const users = new UserRA(tx);
            const held = await users.avatarSha256Of(userID);

            if(held !== null) { await users.clearAvatar(userID); }

            return held;
        });
    }

    // Only a hash some user's avatar references is served.
    async serveAvatar(sha256 : string) : Promise<ServedImage>
    {
        const mime = await this.#users.avatarMimeForSha(sha256);
        if(mime === null) { throw new NotFoundError('No avatar at this hash.'); }

        return this.#images.serve(sha256, mime, 'No avatar at this hash.');
    }
}

//----------------------------------------------------------------------------------------------------------------------
