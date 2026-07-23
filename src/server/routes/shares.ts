//----------------------------------------------------------------------------------------------------------------------
// Share Routes
//
// The sharing surface: grant a share on a node, list a node's grants, revoke a grant, leave a share granted to you, and
// the Shared with me listing, across two roots -- /nodes/:id/shares and /shares/:id. Every handler resolves the caller
// through the session manager (401 when absent) and validates the grant body against the core codec (400 on a shape
// mismatch); all other outcomes -- not found, forbidden, regulation violations -- bubble as typed manager errors that
// onError maps.
//----------------------------------------------------------------------------------------------------------------------

import { Hono } from 'hono';

// Models
import { grantShareRequestCodec, sharedWithMeQueryCodec } from '@fileshed/core';

// Managers
import type { SessionManager } from '../managers/session.ts';
import type { ShareManager } from '../managers/share.ts';

// Routes
import { parseQuery } from './parseQuery.ts';
import { readJsonBody } from './readJsonBody.ts';
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
        const actor = await sessions.requireUser(ctx.req.raw.headers);
        const request = await readJsonBody(ctx, grantShareRequestCodec);

        return ctx.json(await shares.grant(actor, ctx.req.param('id'), request), 201);
    });

    router.get('/nodes/:id/shares', listNodeSharesSpec, async (ctx) =>
    {
        const actor = await sessions.requireUser(ctx.req.raw.headers);

        return ctx.json(await shares.listForNode(actor, ctx.req.param('id')));
    });

    router.get('/shared-with-me', sharedWithMeSpec, async (ctx) =>
    {
        const actor = await sessions.requireUser(ctx.req.raw.headers);
        const query = parseQuery(ctx, sharedWithMeQueryCodec);

        return ctx.json(await shares.sharedWithMe(actor, query));
    });

    router.post('/shares/:id/leave', leaveShareSpec, async (ctx) =>
    {
        const actor = await sessions.requireUser(ctx.req.raw.headers);
        await shares.leave(actor, ctx.req.param('id'));

        return ctx.body(null, 204);
    });

    router.delete('/shares/:id', revokeShareSpec, async (ctx) =>
    {
        const actor = await sessions.requireUser(ctx.req.raw.headers);
        await shares.revoke(actor, ctx.req.param('id'));

        return ctx.body(null, 204);
    });

    return router;
}

//----------------------------------------------------------------------------------------------------------------------
