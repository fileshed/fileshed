//----------------------------------------------------------------------------------------------------------------------
// Download Route
//
// Alongside the session cookie the route accepts a download-scoped token as a bearer header or a ?token= query param,
// which is how a cast receiver -- handed a media URL with no cookie jar -- fetches bytes at all. Responses are private
// (they are credentialed) and no-cache: the ETag makes revalidation a 304, and Range still works.
//----------------------------------------------------------------------------------------------------------------------

import { Hono } from 'hono';

// Models
import { type ContentDisposition, permissionDemands } from '@fileshed/core';

// Managers
import type { PublicLinkManager } from '../../../managers/publicLink.ts';
import type { SessionManager } from '../../../managers/session.ts';

// Routes
import { downloadSpec } from './downloads.openapi.ts';
import { fileResponse } from '../utils/streamResponse.ts';

//----------------------------------------------------------------------------------------------------------------------

// The download disposition off the query string: inline for a browser preview, attachment (the default) for a forced
// download. Anything else falls back to attachment rather than failing the request.
function readDisposition(value : string | undefined) : ContentDisposition
{
    return value === 'inline' ? 'inline' : 'attachment';
}

//----------------------------------------------------------------------------------------------------------------------

export function createDownloadRoutes(sessions : SessionManager, downloads : PublicLinkManager) : Hono
{
    const router = new Hono();

    router.get('/nodes/:id/download', downloadSpec, async (ctx) =>
    {
        const actor = await sessions.resolveActor(
            { kind: 'request', headers: ctx.req.raw.headers, urlToken: ctx.req.query('token') ?? null },
            permissionDemands.filesDownload
        );

        const file = await downloads.download(actor.user, ctx.req.param('id'));

        return fileResponse(file, {
            disposition: readDisposition(ctx.req.query('disposition')),
            rangeHeader: ctx.req.header('range'),
            ifNoneMatch: ctx.req.header('if-none-match'),
        }, { 'cache-control': 'private, no-cache' });
    });

    return router;
}

//----------------------------------------------------------------------------------------------------------------------
