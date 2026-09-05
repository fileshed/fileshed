//----------------------------------------------------------------------------------------------------------------------
// Access Token Routes
//
// The only key-management surface in the deployment -- the api-key plugin's own endpoints are gated shut in app.ts.
// Every route here is session-only via requireUser: tokens cannot mint, list, or revoke tokens, which is what keeps
// a leaked download-scoped credential from laundering itself into fresh ones.
//----------------------------------------------------------------------------------------------------------------------

import { Hono } from 'hono';

// Models
import { createAccessTokenRequestCodec, createPlaybackTokenRequestCodec, toAccessTokenListResponse,
    toAccessTokenResponse } from '@fileshed/core';

// Managers
import type { AccessTokenManager } from '../managers/accessToken.ts';
import type { SessionManager } from '../managers/session.ts';

// Routes
import {
    createAccessTokenSpec,
    createPlaybackTokenSpec,
    listAccessTokensSpec,
    revokeAccessTokenSpec,
} from './accessTokens.openapi.ts';
import { readJsonBody } from './readJsonBody.ts';

//----------------------------------------------------------------------------------------------------------------------

export function createAccessTokenRoutes(sessions : SessionManager, tokens : AccessTokenManager) : Hono
{
    const router = new Hono();

    router.post('/me/access-tokens', createAccessTokenSpec, async (ctx) =>
    {
        const actor = await sessions.requireUser(ctx.req.raw.headers);
        const request = await readJsonBody(ctx, createAccessTokenRequestCodec);

        const minted = await tokens.create(actor, ctx.req.raw.headers, request);

        return ctx.json({ token: minted.token, accessToken: toAccessTokenResponse(minted.accessToken) });
    });

    router.get('/me/access-tokens', listAccessTokensSpec, async (ctx) =>
    {
        await sessions.requireUser(ctx.req.raw.headers);

        return ctx.json(toAccessTokenListResponse(await tokens.list(ctx.req.raw.headers)));
    });

    router.delete('/me/access-tokens/:id', revokeAccessTokenSpec, async (ctx) =>
    {
        await sessions.requireUser(ctx.req.raw.headers);
        await tokens.revoke(ctx.req.raw.headers, ctx.req.param('id'));

        return ctx.body(null, 204);
    });

    router.post('/me/playback-token', createPlaybackTokenSpec, async (ctx) =>
    {
        const actor = await sessions.requireUser(ctx.req.raw.headers);
        const request = await readJsonBody(ctx, createPlaybackTokenRequestCodec);

        const minted = await tokens.mintPlayback(actor, ctx.req.raw.headers, request.previousID);

        return ctx.json({ id: minted.id, token: minted.token, expiresAt: minted.expiresAt.toISOString() });
    });

    return router;
}

//----------------------------------------------------------------------------------------------------------------------
