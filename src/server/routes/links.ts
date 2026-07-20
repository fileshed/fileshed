//----------------------------------------------------------------------------------------------------------------------
// Public Link Management Routes
//
// The owner's link-management surface: POST /api/nodes/:id/links (mint), GET /api/nodes/:id/links (list), and DELETE
// /api/links/:id (revoke). Every handler resolves the caller through the session manager (401 when absent); owner-only
// and file-only enforcement is the manager's. The two path shapes share the /api mount, so this router owns both
// /nodes/:id/links and /links/:id.
//----------------------------------------------------------------------------------------------------------------------

import { Hono } from 'hono';

// Models
import { createPublicLinkRequestCodec, toPublicLinkListResponse, toPublicLinkResponse } from '@fileshed/core';

// Managers
import type { PublicLinkManager } from '../managers/publicLink.ts';
import type { SessionManager } from '../managers/session.ts';

// Routes
import { readJsonBody } from './readJsonBody.ts';

//----------------------------------------------------------------------------------------------------------------------

export function createPublicLinkRoutes(sessions : SessionManager, links : PublicLinkManager) : Hono
{
    const router = new Hono();

    router.post('/nodes/:id/links', async (ctx) =>
    {
        const actor = await sessions.requireUser(ctx.req.raw.headers);
        const request = await readJsonBody(ctx, createPublicLinkRequestCodec);

        const link = await links.createLink(actor, ctx.req.param('id'), request);

        return ctx.json(toPublicLinkResponse(link), 201);
    });

    router.get('/nodes/:id/links', async (ctx) =>
    {
        const actor = await sessions.requireUser(ctx.req.raw.headers);

        const list = await links.listForNode(actor, ctx.req.param('id'));

        return ctx.json(toPublicLinkListResponse(list));
    });

    router.delete('/links/:id', async (ctx) =>
    {
        const actor = await sessions.requireUser(ctx.req.raw.headers);
        await links.revoke(actor, ctx.req.param('id'));

        return ctx.body(null, 204);
    });

    return router;
}

//----------------------------------------------------------------------------------------------------------------------
