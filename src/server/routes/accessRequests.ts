//----------------------------------------------------------------------------------------------------------------------
// Access Request Routes
//
// The share-request surface: a user asks the target's owner for access to a stub, an owner or requester lists their
// requests, and the owner grants or declines. Paths straddle /nodes/:id/access-requests and /access-requests/:id, so
// the router carries full paths and is mounted at /api. Every handler resolves the caller through the session manager
// (401 when absent) and validates the create body against the core codec (400 on a shape mismatch); not-found,
// forbidden, and regulation outcomes bubble as typed manager errors that onError maps.
//----------------------------------------------------------------------------------------------------------------------

import { Hono } from 'hono';

// Models
import { createAccessRequestCodec } from '@fileshed/core';

// Managers
import type { SessionManager } from '../managers/session.ts';
import type { ShareManager } from '../managers/share.ts';

// Routes
import { readJsonBody } from './readJsonBody.ts';

//----------------------------------------------------------------------------------------------------------------------

export function createAccessRequestRoutes(sessions : SessionManager, shares : ShareManager) : Hono
{
    const router = new Hono();

    router.post('/nodes/:id/access-requests', async (ctx) =>
    {
        const actor = await sessions.requireUser(ctx.req.raw.headers);
        const request = await readJsonBody(ctx, createAccessRequestCodec);

        return ctx.json(await shares.requestAccess(actor, ctx.req.param('id'), request), 201);
    });

    router.get('/access-requests', async (ctx) =>
    {
        const actor = await sessions.requireUser(ctx.req.raw.headers);

        return ctx.json(await shares.listAccessRequests(actor));
    });

    router.post('/access-requests/:id/grant', async (ctx) =>
    {
        const actor = await sessions.requireUser(ctx.req.raw.headers);

        return ctx.json(await shares.resolveRequest(actor, ctx.req.param('id'), 'grant'));
    });

    router.post('/access-requests/:id/decline', async (ctx) =>
    {
        const actor = await sessions.requireUser(ctx.req.raw.headers);

        return ctx.json(await shares.resolveRequest(actor, ctx.req.param('id'), 'decline'));
    });

    return router;
}

//----------------------------------------------------------------------------------------------------------------------
