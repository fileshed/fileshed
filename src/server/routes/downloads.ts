//----------------------------------------------------------------------------------------------------------------------
// Download Route
//
// GET /api/nodes/:id/download -- the authed download, with the same Range/ETag byte-serving behavior as the public
// link. Behind the session gate (401 without one); the manager's injected role resolver decides access (viewer
// suffices to download). Disposition is the caller's choice via ?disposition=, defaulting to attachment -- a forced
// download unless a preview (?disposition=inline) is asked for. Mounts at /api.
//----------------------------------------------------------------------------------------------------------------------

import { Hono } from 'hono';

// Models
import type { PublicLinkDisposition } from '@fileshed/core';

// Managers
import type { PublicLinkManager } from '../managers/publicLink.ts';
import type { SessionManager } from '../managers/session.ts';

// Routes
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

    router.get('/nodes/:id/download', async (ctx) =>
    {
        const actor = await sessions.requireUser(ctx.req.raw.headers);

        const result = await links.download(actor, ctx.req.param('id'), {
            disposition: readDisposition(ctx.req.query('disposition')),
            rangeHeader: ctx.req.header('range'),
            ifNoneMatch: ctx.req.header('if-none-match'),
        });

        return streamResponse(result);
    });

    return router;
}

//----------------------------------------------------------------------------------------------------------------------
