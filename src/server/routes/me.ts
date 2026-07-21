//----------------------------------------------------------------------------------------------------------------------
// Me Route
//
// GET /api/me: the caller's own profile plus live quota usage. Behind the session gate like every authenticated route
// (401 when there is no session); the node manager assembles the profile and computes usage fresh from owned file
// nodes.
//----------------------------------------------------------------------------------------------------------------------

import { Hono } from 'hono';

// Managers
import type { NodeManager } from '../managers/node.ts';
import type { SessionManager } from '../managers/session.ts';

// Routes
import { meSpec } from './me.openapi.ts';

//----------------------------------------------------------------------------------------------------------------------

export function createMeRoutes(sessions : SessionManager, nodes : NodeManager) : Hono
{
    const router = new Hono();

    router.get('/me', meSpec, async (ctx) =>
    {
        const actor = await sessions.requireUser(ctx.req.raw.headers);

        return ctx.json(await nodes.me(actor));
    });

    return router;
}

//----------------------------------------------------------------------------------------------------------------------
