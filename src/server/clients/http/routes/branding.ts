//----------------------------------------------------------------------------------------------------------------------
// Branding Routes
//
// /api/branding.css is anonymous by design -- the sign-in page is where branding matters most -- and revalidates by
// ETag so a saved theme applies on the very next page load without a stale-cache window.
//----------------------------------------------------------------------------------------------------------------------

import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';

import { Hono } from 'hono';

// Models
import { updateBrandingRequestCodec } from '@fileshed/core';

// Managers
import type { BrandingManager } from '../../../managers/branding.ts';
import type { SessionManager } from '../../../managers/session.ts';

// Routes
import {
    brandingCssSpec,
    deleteLogoSpec,
    getBrandingSpec,
    getLogoSpec,
    patchBrandingSpec,
    uploadLogoSpec,
} from './branding.openapi.ts';
import { readByteBody } from '../utils/readByteBody.ts';
import { readJsonBody } from '../utils/readJsonBody.ts';
import { USER_CONTENT_HEADERS } from '../utils/userContentHeaders.ts';

//----------------------------------------------------------------------------------------------------------------------

// The logo is public and content-addressed via its ?v= cache-buster, so a long shared max-age is safe: a new
// upload changes the URL, never the bytes behind an old one.
const LOGO_CACHE_CONTROL = 'public, immutable, max-age=31536000';

//----------------------------------------------------------------------------------------------------------------------

export function createBrandingRoutes(sessions : SessionManager, branding : BrandingManager) : Hono
{
    const router = new Hono();

    router.get('/admin/branding', getBrandingSpec, async (ctx) =>
    {
        const user = await sessions.requireUser(ctx.req.raw.headers);

        return ctx.json(await branding.view(user));
    });

    router.patch('/admin/branding', patchBrandingSpec, async (ctx) =>
    {
        const user = await sessions.requireUser(ctx.req.raw.headers);
        const request = await readJsonBody(ctx, updateBrandingRequestCodec);

        return ctx.json(await branding.update(user, request));
    });

    router.post('/admin/branding/logo', uploadLogoSpec, async (ctx) =>
    {
        const user = await sessions.requireUser(ctx.req.raw.headers);

        const { stream, contentLength, mediaType } = readByteBody(ctx, 'A logo body is required.');

        await branding.setLogo(user, stream, mediaType, contentLength);

        return ctx.json({ logo: await branding.logoSha() });
    });

    router.delete('/admin/branding/logo', deleteLogoSpec, async (ctx) =>
    {
        const user = await sessions.requireUser(ctx.req.raw.headers);

        await branding.deleteLogo(user);

        return ctx.body(null, 204);
    });

    router.get('/branding/logo', getLogoSpec, async () =>
    {
        const served = await branding.serveLogo();

        return new Response(Readable.toWeb(served.stream) as BodyInit, {
            status: 200,
            headers: {
                ...USER_CONTENT_HEADERS,
                'content-type': served.mime,
                'content-length': String(served.size),
                'cache-control': LOGO_CACHE_CONTROL,
            },
        });
    });

    router.get('/branding.css', brandingCssSpec, async (ctx) =>
    {
        const css = await branding.css();
        const etag = `"${ createHash('sha256').update(css)
            .digest('hex')
            .slice(0, 32) }"`;

        // RFC 7232 wants the ETag echoed on the 304; some intermediaries drop the cache entry without it.
        if(ctx.req.header('if-none-match') === etag)
        {
            ctx.header('ETag', etag);

            return ctx.body(null, 304);
        }

        ctx.header('Content-Type', 'text/css; charset=utf-8');
        ctx.header('ETag', etag);
        ctx.header('Cache-Control', 'no-cache');

        return ctx.body(css);
    });

    return router;
}

//----------------------------------------------------------------------------------------------------------------------
