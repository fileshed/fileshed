//----------------------------------------------------------------------------------------------------------------------
// Branding Routes
//
// The admin's theme surface plus the stylesheet everyone loads. /api/branding.css is anonymous by design -- the
// sign-in page is where branding matters most -- and revalidates by ETag so a saved theme applies on the very
// next page load without a stale-cache window.
//----------------------------------------------------------------------------------------------------------------------

import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import type { ReadableStream as NodeReadableStream } from 'node:stream/web';

import { Hono } from 'hono';

// Models
import { BadRequestError, NotFoundError, updateBrandingRequestCodec } from '@fileshed/core';

// Managers
import type { BrandingManager } from '../managers/branding.ts';
import type { SessionManager } from '../managers/session.ts';

// Routes
import {
    brandingCssSpec,
    deleteLogoSpec,
    getBrandingSpec,
    getLogoSpec,
    patchBrandingSpec,
    uploadLogoSpec,
} from './branding.openapi.ts';
import { readJsonBody } from './readJsonBody.ts';
import { USER_CONTENT_HEADERS } from './userContentHeaders.ts';

//----------------------------------------------------------------------------------------------------------------------

// The logo is public and content-addressed via its ?v= cache-buster, so a long shared max-age is safe: a new
// upload changes the URL, never the bytes behind an old one.
const LOGO_CACHE_CONTROL = 'public, immutable, max-age=31536000';

function parseContentLength(header : string | undefined) : number | undefined
{
    if(header === undefined) { return undefined; }

    const value = Number(header);
    return Number.isInteger(value) && value >= 0 ? value : undefined;
}

//----------------------------------------------------------------------------------------------------------------------

export function createBrandingRoutes(sessions : SessionManager, branding : BrandingManager) : Hono
{
    const router = new Hono();

    router.get('/admin/branding', getBrandingSpec, async (ctx) =>
    {
        const actor = await sessions.requireUser(ctx.req.raw.headers);

        return ctx.json(await branding.view(actor));
    });

    router.patch('/admin/branding', patchBrandingSpec, async (ctx) =>
    {
        const actor = await sessions.requireUser(ctx.req.raw.headers);
        const request = await readJsonBody(ctx, updateBrandingRequestCodec);

        return ctx.json(await branding.update(actor, request));
    });

    router.post('/admin/branding/logo', uploadLogoSpec, async (ctx) =>
    {
        const actor = await sessions.requireUser(ctx.req.raw.headers);

        const body = ctx.req.raw.body;
        if(body === null) { throw new BadRequestError('A logo body is required.'); }

        await branding.setLogo(
            actor,
            Readable.fromWeb(body as NodeReadableStream<Uint8Array>),
            ctx.req.header('content-type'),
            parseContentLength(ctx.req.header('content-length'))
        );

        return ctx.json({ logo: await branding.logoSha() });
    });

    router.delete('/admin/branding/logo', deleteLogoSpec, async (ctx) =>
    {
        const actor = await sessions.requireUser(ctx.req.raw.headers);

        await branding.deleteLogo(actor);

        return ctx.body(null, 204);
    });

    router.get('/branding/logo', getLogoSpec, async () =>
    {
        const served = await branding.serveLogo();
        if(served === null) { throw new NotFoundError('No logo is set.'); }

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
