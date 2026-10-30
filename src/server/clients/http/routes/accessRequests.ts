//----------------------------------------------------------------------------------------------------------------------
// Access Request Routes
//----------------------------------------------------------------------------------------------------------------------

import { Hono } from 'hono';

// Models
import { createAccessRequestCodec, permissionDemands } from '@fileshed/core';

// Managers
import type { SessionManager } from '../../../managers/session.ts';
import type { ShareManager } from '../../../managers/share.ts';

// Routes
import {
    declineAccessRequestSpec,
    grantAccessRequestSpec,
    listAccessRequestsSpec,
    requestAccessSpec,
} from './accessRequests.openapi.ts';
import { readJsonBody } from '../utils/readJsonBody.ts';

//----------------------------------------------------------------------------------------------------------------------

export function createAccessRequestRoutes(sessions : SessionManager, shares : ShareManager) : Hono
{
    const router = new Hono();

    router.post('/nodes/:id/access-requests', requestAccessSpec, async (ctx) =>
    {
        const actor = await sessions.requireActor(ctx.req.raw.headers, permissionDemands.sharesWrite);
        const request = await readJsonBody(ctx, createAccessRequestCodec);

        return ctx.json(await shares.requestAccess(actor.user, ctx.req.param('id'), request), 201);
    });

    router.get('/access-requests', listAccessRequestsSpec, async (ctx) =>
    {
        const actor = await sessions.requireActor(ctx.req.raw.headers, permissionDemands.sharesRead);

        return ctx.json(await shares.listAccessRequests(actor.user));
    });

    router.post('/access-requests/:id/grant', grantAccessRequestSpec, async (ctx) =>
    {
        const actor = await sessions.requireActor(ctx.req.raw.headers, permissionDemands.sharesWrite);

        return ctx.json(await shares.resolveRequest(actor.user, ctx.req.param('id'), 'grant'));
    });

    router.post('/access-requests/:id/decline', declineAccessRequestSpec, async (ctx) =>
    {
        const actor = await sessions.requireActor(ctx.req.raw.headers, permissionDemands.sharesWrite);

        return ctx.json(await shares.resolveRequest(actor.user, ctx.req.param('id'), 'decline'));
    });

    return router;
}

//----------------------------------------------------------------------------------------------------------------------
