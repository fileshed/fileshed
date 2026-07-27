//----------------------------------------------------------------------------------------------------------------------
// Direct Link Route
//
// GET /d/:token -- the anonymous, hotlinkable direct link. NO auth by design: the token is the capability, so this
// surface mounts OUTSIDE /api. The manager resolves the token to a file node and returns the byte-serving result
// (Range/ETag/disposition); a dead link -- unknown, revoked, or a gone/trashed target -- surfaces as a NotFoundError
// that onError maps to 404. The route carries no status logic beyond building the stream response. Cacheable by
// anyone but always revalidated: a revoked link must die everywhere immediately, and the content-hash ETag makes
// revalidation a cheap 304.
//----------------------------------------------------------------------------------------------------------------------

import { Hono } from 'hono';

// Managers
import type { PublicLinkManager } from '../managers/publicLink.ts';

// Routes
import { directSpec } from './direct.openapi.ts';
import { streamResponse } from './streamResponse.ts';

//----------------------------------------------------------------------------------------------------------------------

export function createDirectRoutes(links : PublicLinkManager) : Hono
{
    const router = new Hono();

    router.get('/:token', directSpec, async (ctx) =>
    {
        const result = await links.resolveByToken(ctx.req.param('token'), {
            rangeHeader: ctx.req.header('range'),
            ifNoneMatch: ctx.req.header('if-none-match'),
        });

        return streamResponse(result, { 'cache-control': 'public, no-cache' });
    });

    return router;
}

//----------------------------------------------------------------------------------------------------------------------
