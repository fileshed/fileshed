//----------------------------------------------------------------------------------------------------------------------
// Me Route
//
// GET /api/me: the caller's own profile plus live quota usage and preferences. PATCH /api/me/preferences: a key-wise
// merge into the caller's preferences blob, answering the refreshed profile. Both sit behind the session gate like
// every authenticated route (401 when there is no session); the node manager assembles the profile and computes usage
// fresh from owned file nodes.
//----------------------------------------------------------------------------------------------------------------------

import { Hono } from 'hono';

// Models
import { updatePreferencesRequestCodec } from '@fileshed/core';

// Managers
import type { NodeManager } from '../managers/node.ts';
import type { SessionManager } from '../managers/session.ts';

// Routes
import { meSpec, updatePreferencesSpec } from './me.openapi.ts';
import { readJsonBody } from './readJsonBody.ts';

//----------------------------------------------------------------------------------------------------------------------

export function createMeRoutes(sessions : SessionManager, nodes : NodeManager) : Hono
{
    const router = new Hono();

    router.get('/me', meSpec, async (ctx) =>
    {
        const actor = await sessions.requireUser(ctx.req.raw.headers);

        return ctx.json(await nodes.me(actor));
    });

    router.patch('/me/preferences', updatePreferencesSpec, async (ctx) =>
    {
        const actor = await sessions.requireUser(ctx.req.raw.headers);
        const patch = await readJsonBody(ctx, updatePreferencesRequestCodec);

        return ctx.json(await nodes.updatePreferences(actor, patch));
    });

    return router;
}

//----------------------------------------------------------------------------------------------------------------------
