//----------------------------------------------------------------------------------------------------------------------
// Public Link Management Routes
//
// The owner's link-management surface: POST /api/nodes/:id/links (mint), GET /api/nodes/:id/links (list), and DELETE
// /api/links/:id (revoke). Minting and revoking demand shares:write -- the publish-capable scope, since a public link
// makes bytes world-readable -- and listing demands shares:read; owner-only and file-only enforcement is the
// manager's.
//----------------------------------------------------------------------------------------------------------------------

import { Hono } from 'hono';

// Models
import { permissionDemands, toPublicLinkListResponse, toPublicLinkResponse } from '@fileshed/core';

// Managers
import type { PublicLinkManager } from '../managers/publicLink.ts';
import type { SessionManager } from '../managers/session.ts';

// Routes
import { createLinkSpec, listLinksSpec, revokeLinkSpec } from './links.openapi.ts';

//----------------------------------------------------------------------------------------------------------------------

export function createPublicLinkRoutes(sessions : SessionManager, links : PublicLinkManager) : Hono
{
    const router = new Hono();

    router.post('/nodes/:id/links', createLinkSpec, async (ctx) =>
    {
        const actor = await sessions.requireActor(ctx.req.raw.headers, permissionDemands.sharesWrite);

        const link = await links.createLink(actor.user, ctx.req.param('id'));

        return ctx.json(toPublicLinkResponse(link), 201);
    });

    router.get('/nodes/:id/links', listLinksSpec, async (ctx) =>
    {
        const actor = await sessions.requireActor(ctx.req.raw.headers, permissionDemands.sharesRead);

        const list = await links.listForNode(actor.user, ctx.req.param('id'));

        return ctx.json(toPublicLinkListResponse(list));
    });

    router.delete('/links/:id', revokeLinkSpec, async (ctx) =>
    {
        const actor = await sessions.requireActor(ctx.req.raw.headers, permissionDemands.sharesWrite);
        await links.revoke(actor.user, ctx.req.param('id'));

        return ctx.body(null, 204);
    });

    return router;
}

//----------------------------------------------------------------------------------------------------------------------
