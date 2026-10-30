//----------------------------------------------------------------------------------------------------------------------
// Branding Manager
//
// The theme document's owner: one JSON row under the BRANDING key, deliberately outside the settings vocabulary
// so the generic settings PATCH can never write it unvalidated. Updates merge key-wise over the RAW stored
// object -- keys this version does not know survive untouched, which is what lets a future theme package or a
// newer client coexist with an older server.
//
// The logo is a referenced image (managers/referencedImages.ts), not part of the document: its reference is the
// BRANDING_LOGO_SHA row that graveyardUnreferenced counts.
//----------------------------------------------------------------------------------------------------------------------

import type { Readable } from 'node:stream';

// Models
import {
    type InstanceTheme,
    NotFoundError,
    type UpdateBrandingRequest,
    brandingImageMimeTypes,
    toInstanceTheme,
} from '@fileshed/core';

// Engines
import { assertAdmin } from '../engines/adminAccess.ts';
import { renderBrandingCSS } from '../engines/branding.ts';

// Managers
import { ReferencedImages, type ServedImage } from './referencedImages.ts';

// Resource Access
import type { BlobRA } from '../resource-access/blob/index.ts';
import type { DatabaseHandle } from '../resource-access/database/database.ts';
import type { SessionUser } from '../resource-access/auth/instance.ts';
import { SettingsRA } from '../resource-access/settings/index.ts';

// Utils
import { getLogger } from '../utils/logger.ts';

//----------------------------------------------------------------------------------------------------------------------

const logger = getLogger('branding');

const BRANDING_KEY = 'BRANDING';
const LOGO_SHA_KEY = 'BRANDING_LOGO_SHA';
const LOGO_TYPE_KEY = 'BRANDING_LOGO_TYPE';

export interface BrandingManagerDeps
{
    handle : DatabaseHandle;
    blob : BlobRA;

    // Read at use time, per request; the logo shares the avatar's cap on purpose -- both are small images.
    maxBytes : () => Promise<number>;
}

function shaFrom(stored : unknown) : string | null
{
    return typeof stored === 'string' && stored !== '' ? stored : null;
}

//----------------------------------------------------------------------------------------------------------------------

export class BrandingManager
{
    readonly #ra : SettingsRA;
    readonly #images : ReferencedImages;
    readonly #maxBytes : () => Promise<number>;

    constructor(deps : BrandingManagerDeps)
    {
        this.#ra = new SettingsRA(deps.handle);
        this.#images = new ReferencedImages(deps.handle, deps.blob);
        this.#maxBytes = deps.maxBytes;
    }

    async #raw() : Promise<Record<string, unknown>>
    {
        const stored = await this.#ra.get(BRANDING_KEY);

        return typeof stored === 'object' && stored !== null && !Array.isArray(stored)
            ? stored as Record<string, unknown>
            : {};
    }

    async theme() : Promise<InstanceTheme>
    {
        return toInstanceTheme(await this.#raw());
    }

    async view(user : SessionUser) : Promise<InstanceTheme>
    {
        assertAdmin(user);

        return this.theme();
    }

    async update(user : SessionUser, patch : UpdateBrandingRequest) : Promise<InstanceTheme>
    {
        assertAdmin(user);

        const merged = { ...await this.#raw(), ...patch };
        await this.#ra.upsert(BRANDING_KEY, merged);
        logger.info({ userID: user.id, fields: Object.keys(patch) }, 'Admin changed the branding');

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
        return shaFrom(await this.#ra.get(LOGO_SHA_KEY));
    }

    // Store an uploaded logo and point the instance at it, graveyarding the one it replaced.
    async setLogo(
        user : SessionUser,
        source : Readable,
        mediaType : string | null,
        declaredLength : number | undefined
    ) : Promise<void>
    {
        assertAdmin(user);

        const rules = {
            accepts: brandingImageMimeTypes,
            maxBytes: await this.#maxBytes(),
            notAccepted: 'The logo must be a PNG, JPEG, WebP, GIF, SVG, or ICO image.',
            tooLarge: 'The logo exceeds the maximum size.',
        };

        const stored = await this.#images.store({ source, mediaType, declaredLength }, rules, async (image, tx) =>
        {
            const settings = new SettingsRA(tx);
            const replaced = shaFrom(await settings.get(LOGO_SHA_KEY));

            await settings.upsert(LOGO_SHA_KEY, image.sha256);
            await settings.upsert(LOGO_TYPE_KEY, image.media);

            return replaced;
        });
        logger.info({ userID: user.id, sha256: stored.sha256 }, 'Admin set the logo');
    }

    // Idempotent.
    async deleteLogo(user : SessionUser) : Promise<void>
    {
        assertAdmin(user);

        await this.#images.clear(async (tx) =>
        {
            const settings = new SettingsRA(tx);
            const held = shaFrom(await settings.get(LOGO_SHA_KEY));

            await settings.remove(LOGO_SHA_KEY);
            await settings.remove(LOGO_TYPE_KEY);

            return held;
        });
        logger.info({ userID: user.id }, 'Admin removed the logo');
    }

    // Only the CURRENT logo is served, which is what keeps the anonymous route from serving any other blob.
    async serveLogo() : Promise<ServedImage>
    {
        const [ sha, storedType ] = await Promise.all([ this.logoSha(), this.#ra.get(LOGO_TYPE_KEY) ]);
        if(sha === null) { throw new NotFoundError('No logo is set.'); }

        const mime = typeof storedType === 'string' && storedType !== '' ? storedType : 'application/octet-stream';

        return this.#images.serve(sha, mime, 'No logo is set.');
    }
}

//----------------------------------------------------------------------------------------------------------------------
