//----------------------------------------------------------------------------------------------------------------------
// Share Routes
//
// Shared with me demands files:read rather than shares:read: it is how a mount lists its shared roots, and the grant
// metadata riding along is incidental.
//----------------------------------------------------------------------------------------------------------------------

import { Hono } from 'hono';

// Models
import { grantShareRequestCodec, permissionDemands, sharedWithMeQueryCodec } from '@fileshed/core';

// Managers
import type { SessionManager } from '../../../managers/session.ts';
import type { ShareManager } from '../../../managers/share.ts';

// Routes
import { parseQuery } from '../utils/parseQuery.ts';
import { readJSONBody } from '../utils/readJSONBody.ts';
import {
    grantShareSpec,
    leaveShareSpec,
    listNodeSharesSpec,
    revokeShareSpec,
    sharedWithMeSpec,
} from './shares.openapi.ts';

//----------------------------------------------------------------------------------------------------------------------

export function createShareRoutes(sessions : SessionManager, shares : ShareManager) : Hono
{
    const router = new Hono();

    router.post('/nodes/:id/shares', grantShareSpec, async (ctx) =>
    {
        const actor = await sessions.requireActor(ctx.req.raw.headers, permissionDemands.sharesWrite);
        const request = await readJSONBody(ctx, grantShareRequestCodec);

        return ctx.json(await shares.grant(actor.user, ctx.req.param('id'), request), 201);
    });

    router.get('/nodes/:id/shares', listNodeSharesSpec, async (ctx) =>
    {
        const actor = await sessions.requireActor(ctx.req.raw.headers, permissionDemands.sharesRead);

        return ctx.json(await shares.listForNode(actor.user, ctx.req.param('id')));
    });

    router.get('/shared-with-me', sharedWithMeSpec, async (ctx) =>
    {
        const actor = await sessions.requireActor(ctx.req.raw.headers, permissionDemands.filesRead);
        const query = parseQuery(ctx, sharedWithMeQueryCodec);

        return ctx.json(await shares.sharedWithMe(actor.user, query));
    });

    router.post('/shares/:id/leave', leaveShareSpec, async (ctx) =>
    {
        const actor = await sessions.requireActor(ctx.req.raw.headers, permissionDemands.sharesWrite);
        await shares.leave(actor.user, ctx.req.param('id'));

        return ctx.body(null, 204);
    });

    router.delete('/shares/:id', revokeShareSpec, async (ctx) =>
    {
        const actor = await sessions.requireActor(ctx.req.raw.headers, permissionDemands.sharesWrite);
        await shares.revoke(actor.user, ctx.req.param('id'));

        return ctx.body(null, 204);
    });

    return router;
}

//----------------------------------------------------------------------------------------------------------------------
