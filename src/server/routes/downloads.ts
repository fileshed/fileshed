//----------------------------------------------------------------------------------------------------------------------
// Download Route
//
// GET /api/nodes/:id/download -- the authed download, with the same Range/ETag byte-serving behavior as the public
// link. The first route on the access-token plane: alongside the session cookie it accepts a download-scoped token
// as a bearer header or ?token= query param, which is how cast receivers -- handed a media URL with no cookie jar --
// fetch bytes at all. The manager's injected role resolver decides access as the resolved user (viewer suffices).
// Disposition is the caller's choice via ?disposition=, defaulting to attachment. Responses revalidate rather than
// cache-forever: private (a credentialed response), no-cache (ETag makes revalidation a 304, and Range still works).
// Mounts at /api.
//----------------------------------------------------------------------------------------------------------------------

import { Hono } from 'hono';

// Models
import { type PublicLinkDisposition, permissionDemands } from '@fileshed/core';

// Managers
import type { PublicLinkManager } from '../managers/publicLink.ts';
import type { SessionManager } from '../managers/session.ts';

// Routes
import { downloadSpec } from './downloads.openapi.ts';
import { streamResponse } from './streamResponse.ts';

//----------------------------------------------------------------------------------------------------------------------

// The download disposition off the query string: inline for a browser preview, attachment (the default) for a forced
// download. Anything else falls back to attachment rather than failing the request.
function readDisposition(value : string | undefined) : PublicLinkDisposition
{
    return value === 'inline' ? 'inline' : 'attachment';
}

//----------------------------------------------------------------------------------------------------------------------

export function createDownloadRoutes(sessions : SessionManager, links : PublicLinkManager) : Hono
{
    const router = new Hono();

    router.get('/nodes/:id/download', downloadSpec, async (ctx) =>
    {
        const actor = await sessions.resolveActor(
            { kind: 'request', headers: ctx.req.raw.headers, urlToken: ctx.req.query('token') ?? null },
            permissionDemands.filesDownload
        );

        const result = await links.download(actor.user, ctx.req.param('id'), {
            disposition: readDisposition(ctx.req.query('disposition')),
            rangeHeader: ctx.req.header('range'),
            ifNoneMatch: ctx.req.header('if-none-match'),
        });

        return streamResponse(result, { 'cache-control': 'private, no-cache' });
    });

    return router;
}

//----------------------------------------------------------------------------------------------------------------------
