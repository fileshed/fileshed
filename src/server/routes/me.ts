//----------------------------------------------------------------------------------------------------------------------
// Me Route
//
// GET /api/me: the caller's own profile plus live quota usage and preferences -- readable with an account:read
// token, so a status-bar script can watch its quota. PATCH /api/me/preferences stays session-only: no token
// mutates account state. The node manager assembles the profile and computes usage fresh from owned file nodes.
//----------------------------------------------------------------------------------------------------------------------

import { Hono } from 'hono';

// Models
import { permissionDemands, updatePreferencesRequestCodec } from '@fileshed/core';

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
        const actor = await sessions.requireActor(ctx.req.raw.headers, permissionDemands.accountRead);

        return ctx.json(await nodes.me(actor.user));
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
