//----------------------------------------------------------------------------------------------------------------------
// Branding Manager
//
// The theme document's owner: one JSON row under the BRANDING key, deliberately outside the settings vocabulary
// so the generic settings PATCH can never write it unvalidated. Updates merge key-wise over the RAW stored
// object -- keys this version does not know survive untouched, which is what lets a future theme package or a
// newer client coexist with an older server.
//
// The logo rides the avatar pattern, not the document: bytes in the content-addressed blob store, referenced by
// the BRANDING_LOGO_SHA row that graveyardUnreferenced counts, replaced-and-graveyarded in one transaction. Its
// serve gate is the route shape itself -- /api/branding/logo serves only the CURRENT logo, so the anonymous
// endpoint can never become an oracle for other blobs.
//----------------------------------------------------------------------------------------------------------------------

import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';

// Models
import {
    BadRequestError,
    type BrandingImageMimeType,
    ForbiddenError,
    type InstanceTheme,
    PayloadTooLargeError,
    type UpdateBrandingRequest,
    brandingImageMimeTypes,
    toInstanceTheme,
} from '@fileshed/core';

// Engines
import { renderBrandingCSS } from '../engines/branding.ts';

// Resource Access
import { BlobRA } from '../resource-access/blob/index.ts';
import type { DatabaseHandle } from '../resource-access/database/database.ts';
import type { SessionUser } from '../resource-access/auth.ts';
import { SettingsRA } from '../resource-access/settings/index.ts';

// Utils
import { collectCapped, mediaType } from '../utils/uploadBody.ts';

//----------------------------------------------------------------------------------------------------------------------

const BRANDING_KEY = 'BRANDING';
const LOGO_SHA_KEY = 'BRANDING_LOGO_SHA';
const LOGO_TYPE_KEY = 'BRANDING_LOGO_TYPE';

export interface BrandingDeps
{
    settings : SettingsRA;
    handle : DatabaseHandle;
    blob : BlobRA;

    // Read at use time, per request; the logo shares the avatar's cap on purpose -- both are small images.
    maxBytes : () => Promise<number>;
}

export interface ServedLogo
{
    stream : Readable;
    mime : string;
    size : number;
}

function isBrandingImageMime(value : string | null) : value is BrandingImageMimeType
{
    return value !== null && (brandingImageMimeTypes as readonly string[]).includes(value);
}

//----------------------------------------------------------------------------------------------------------------------

export class BrandingManager
{
    readonly #ra : SettingsRA;
    readonly #handle : DatabaseHandle;
    readonly #blob : BlobRA;
    readonly #maxBytes : () => Promise<number>;

    constructor(deps : BrandingDeps)
    {
        this.#ra = deps.settings;
        this.#handle = deps.handle;
        this.#blob = deps.blob;
        this.#maxBytes = deps.maxBytes;
    }

    async #raw() : Promise<Record<string, unknown>>
    {
        const stored = await this.#ra.get(BRANDING_KEY);

        return typeof stored === 'object' && stored !== null && !Array.isArray(stored)
            ? stored as Record<string, unknown>
            : {};
    }

    #requireAdmin(actor : SessionUser) : void
    {
        if(actor.role !== 'admin') { throw new ForbiddenError('Admin access required.'); }
    }

    async theme() : Promise<InstanceTheme>
    {
        return toInstanceTheme(await this.#raw());
    }

    async view(actor : SessionUser) : Promise<InstanceTheme>
    {
        this.#requireAdmin(actor);

        return this.theme();
    }

    async update(actor : SessionUser, patch : UpdateBrandingRequest) : Promise<InstanceTheme>
    {
        this.#requireAdmin(actor);

        const merged = { ...await this.#raw(), ...patch };
        await this.#ra.upsert(BRANDING_KEY, merged);

        return toInstanceTheme(merged);
    }

    async css() : Promise<string>
    {
        return renderBrandingCSS(await this.theme());
    }

    //------------------------------------------------------------------------------------------------------------------
    // Logo
    //------------------------------------------------------------------------------------------------------------------

    async logoSha() : Promise<string | null>
    {
        const stored = await this.#ra.get(LOGO_SHA_KEY);

        return typeof stored === 'string' && stored !== '' ? stored : null;
    }

    // Store an uploaded logo and point the instance at it: mime and cap checked before anything is written, the
    // bytes hashed and stored content-addressed, then the reference rows move and the replaced blob (if any, and
    // if now unreferenced) is graveyarded -- all in one transaction, mirroring the avatar lifecycle.
    async setLogo(
        actor : SessionUser,
        source : Readable,
        contentType : string | undefined,
        declaredLength : number | undefined
    ) : Promise<void>
    {
        this.#requireAdmin(actor);

        const media = mediaType(contentType);
        if(!isBrandingImageMime(media))
        {
            throw new BadRequestError('The logo must be a PNG, JPEG, WebP, GIF, SVG, or ICO image.');
        }

        const maxBytes = await this.#maxBytes();
        if(declaredLength !== undefined && declaredLength > maxBytes)
        {
            throw new PayloadTooLargeError('The logo exceeds the maximum size.');
        }

        const bytes = await collectCapped(source, maxBytes, 'The logo exceeds the maximum size.');
        const sha256 = createHash('sha256')
            .update(bytes)
            .digest('hex');

        const location = await this.#blob.put(sha256, Readable.from(bytes), bytes.length);

        await this.#handle.db.transaction().execute(async (trx) =>
        {
            const txHandle : DatabaseHandle = { db: trx, kind: this.#handle.kind };
            const blob = new BlobRA(txHandle);
            const settings = new SettingsRA(txHandle);

            const oldSha = await settings.get(LOGO_SHA_KEY);

            await blob.insertOrResurrect({
                sha256,
                size: bytes.length,
                backendID: location.backendID,
                storageKey: location.storageKey,
            });
            await settings.upsert(LOGO_SHA_KEY, sha256);
            await settings.upsert(LOGO_TYPE_KEY, media);

            if(typeof oldSha === 'string' && oldSha !== '' && oldSha !== sha256)
            {
                await blob.graveyardUnreferenced([ oldSha ], trx);
            }
        });
    }

    // Drop the logo and graveyard the blob it held (when nothing else references it). Idempotent.
    async deleteLogo(actor : SessionUser) : Promise<void>
    {
        this.#requireAdmin(actor);

        await this.#handle.db.transaction().execute(async (trx) =>
        {
            const txHandle : DatabaseHandle = { db: trx, kind: this.#handle.kind };
            const blob = new BlobRA(txHandle);
            const settings = new SettingsRA(txHandle);

            const oldSha = await settings.get(LOGO_SHA_KEY);

            await settings.remove(LOGO_SHA_KEY);
            await settings.remove(LOGO_TYPE_KEY);

            if(typeof oldSha === 'string' && oldSha !== '')
            {
                await blob.graveyardUnreferenced([ oldSha ], trx);
            }
        });
    }

    // The bytes of the CURRENT logo, or null while none is set. Serving only the referenced hash is the gate
    // that keeps the anonymous route from exfiltrating arbitrary blobs.
    async serveLogo() : Promise<ServedLogo | null>
    {
        const [ sha, storedType ] = await Promise.all([ this.logoSha(), this.#ra.get(LOGO_TYPE_KEY) ]);
        if(sha === null) { return null; }

        const row = await this.#blob.get(sha);
        if(row === undefined) { return null; }

        const stream = await this.#blob.getStream({ backendID: row.backendID, storageKey: row.storageKey });
        const mime = typeof storedType === 'string' && storedType !== '' ? storedType : 'application/octet-stream';

        return { stream, mime, size: row.size };
    }
}

//----------------------------------------------------------------------------------------------------------------------
