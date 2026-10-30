//----------------------------------------------------------------------------------------------------------------------
// Referenced Images
//
// The small images a row points at -- a user's avatar, the instance logo. Their bytes share the content-addressed
// blob store with file content but belong to no node, so they charge no quota; the reference is what keeps one alive,
// and graveyardUnreferenced counts it. A reference moves, and the hash it left is graveyarded, in one transaction, so
// a crash never leaves the row and the graveyard disagreeing.
//----------------------------------------------------------------------------------------------------------------------

import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';

// Models
import { BadRequestError, BlobNotFoundError, NotFoundError, PayloadTooLargeError, isOneOf } from '@fileshed/core';

// Engines
import { mimeMatchesBytes } from '../engines/imageFormat.ts';

// Resource Access
import { BlobRA } from '../resource-access/blob/index.ts';
import { type DatabaseHandle, inTransaction } from '../resource-access/database/database.ts';

// Utils
import { collectCapped } from '../utils/uploadBody.ts';

//----------------------------------------------------------------------------------------------------------------------

export interface ImageUpload
{
    source : Readable;
    mediaType : string | null;
    declaredLength : number | undefined;
}

// What one kind of image accepts, and how it says no.
export interface ImageRules<M extends string>
{
    accepts : readonly M[];
    maxBytes : number;
    notAccepted : string;
    tooLarge : string;
}

export interface StoredImage<M extends string>
{
    sha256 : string;
    media : M;
}

export interface ServedImage
{
    stream : Readable;
    mime : string;
    size : number;
}

// Moves a reference inside the store's transaction and answers the hash it pointed at before, or null for none.
export type Repoint<M extends string> = (image : StoredImage<M>, tx : DatabaseHandle) => Promise<string | null>;

// Drops a reference inside the transaction and answers the hash it held, or null when there was none.
export type Unpoint = (tx : DatabaseHandle) => Promise<string | null>;

//----------------------------------------------------------------------------------------------------------------------

export class ReferencedImages
{
    readonly #handle : DatabaseHandle;
    readonly #blob : BlobRA;

    constructor(handle : DatabaseHandle, blob : BlobRA)
    {
        this.#handle = handle;
        this.#blob = blob;
    }

    // The type and the byte cap are checked before anything is written.
    async store<M extends string>(upload : ImageUpload, rules : ImageRules<M>, repoint : Repoint<M>)
    : Promise<StoredImage<M>>
    {
        const media = upload.mediaType;
        if(!isOneOf(rules.accepts, media)) { throw new BadRequestError(rules.notAccepted); }

        if(upload.declaredLength !== undefined && upload.declaredLength > rules.maxBytes)
        {
            throw new PayloadTooLargeError(rules.tooLarge, rules.maxBytes);
        }

        const bytes = await collectCapped(upload.source, rules.maxBytes, rules.tooLarge);

        // The header is a claim; the bytes are the fact. They are served back under the declared type, and the store
        // they land in is shared with file content, so a claim nothing checks means holding whatever the uploader
        // sent under a name that says otherwise. SVG passes as a container check only.
        if(!mimeMatchesBytes(media, bytes)) { throw new BadRequestError(`Those bytes are not a ${ media } image.`); }

        const image : StoredImage<M> = {
            sha256: createHash('sha256')
                .update(bytes)
                .digest('hex'),
            media,
        };

        // Bytes first, outside the transaction (the store verifies them against the hash while writing); the record and
        // the reference move commit together below. A transaction that refuses therefore leaves the bytes behind with
        // no record naming them -- which is what the GC sweep's reconciling pass exists to find and reclaim.
        const location = await this.#blob.put(image.sha256, Readable.from(bytes), bytes.length);

        await this.#inTransaction(async (tx, blob) =>
        {
            await blob.insertOrResurrect({ sha256: image.sha256, size: bytes.length, ...location });

            const replaced = await repoint(image, tx);

            // An unchanged image leaves the reference on the same hash, which the sweep would find referenced anyway.
            if(replaced !== null && replaced !== image.sha256) { await blob.graveyardUnreferenced([ replaced ]); }
        });

        return image;
    }

    async clear(unpoint : Unpoint) : Promise<void>
    {
        await this.#inTransaction(async (tx, blob) =>
        {
            const held = await unpoint(tx);
            if(held !== null) { await blob.graveyardUnreferenced([ held ]); }
        });
    }

    // The bytes behind a hash the caller has already found referenced. That check is the serve gate: the store holds
    // private file content by hash, so serving one nothing points at would make the route an oracle for any blob.
    // `missing` is the refusal for a referenced hash whose record or bytes are gone.
    async serve(sha256 : string, mime : string, missing : string) : Promise<ServedImage>
    {
        const row = await this.#blob.get(sha256);
        if(row === undefined) { throw new NotFoundError(missing); }

        try
        {
            const stream = await this.#blob.getStream(row);

            return { stream, mime, size: row.size };
        }
        catch(error)
        {
            if(error instanceof BlobNotFoundError) { throw new NotFoundError(missing); }
            throw error;
        }
    }

    async #inTransaction(work : (tx : DatabaseHandle, blob : BlobRA) => Promise<void>) : Promise<void>
    {
        await inTransaction(this.#handle, (tx) => work(tx, new BlobRA(tx)));
    }
}

//----------------------------------------------------------------------------------------------------------------------
