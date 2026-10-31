//----------------------------------------------------------------------------------------------------------------------
// Public Link Management Routes
//
// Minting and revoking demand shares:write, the publish-capable scope, because a public link makes bytes
// world-readable.
//----------------------------------------------------------------------------------------------------------------------

import { Hono } from 'hono';

// Models
import { permissionDemands } from '@fileshed/core';

// Managers
import type { PublicLinkManager } from '../../../managers/publicLink.ts';
import type { SessionManager } from '../../../managers/session.ts';

// Routes
import { createLinkSpec, listLinksSpec, revokeLinkSpec } from './links.openapi.ts';

//----------------------------------------------------------------------------------------------------------------------

export function createPublicLinkRoutes(sessions : SessionManager, links : PublicLinkManager) : Hono
{
    const router = new Hono();

    router.post('/nodes/:id/links', createLinkSpec, async (ctx) =>
    {
        const actor = await sessions.requireActor(ctx.req.raw.headers, permissionDemands.sharesWrite);

        return ctx.json(await links.createLink(actor.user, ctx.req.param('id')), 201);
    });

    router.get('/nodes/:id/links', listLinksSpec, async (ctx) =>
    {
        const actor = await sessions.requireActor(ctx.req.raw.headers, permissionDemands.sharesRead);

        return ctx.json(await links.listForNode(actor.user, ctx.req.param('id')));
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
