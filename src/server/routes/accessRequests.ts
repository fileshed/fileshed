//----------------------------------------------------------------------------------------------------------------------
// Access Request Routes
//
// The share-request surface: a user asks the target's owner for access to a stub, an owner or requester lists their
// requests, and the owner grants or declines, across /nodes/:id/access-requests and /access-requests/:id. Asking and
// resolving change the sharing relationship, so they demand shares:write; listing demands shares:read. The create
// body validates against the core codec (400 on a shape mismatch); not-found, forbidden, and regulation outcomes
// bubble as typed manager errors that onError maps.
//----------------------------------------------------------------------------------------------------------------------

import { Hono } from 'hono';

// Models
import { createAccessRequestCodec, permissionDemands } from '@fileshed/core';

// Managers
import type { SessionManager } from '../managers/session.ts';
import type { ShareManager } from '../managers/share.ts';

// Routes
import {
    declineAccessRequestSpec,
    grantAccessRequestSpec,
    listAccessRequestsSpec,
    requestAccessSpec,
} from './accessRequests.openapi.ts';
import { readJsonBody } from './readJsonBody.ts';

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
