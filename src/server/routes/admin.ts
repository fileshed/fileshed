//----------------------------------------------------------------------------------------------------------------------
// Admin Routes
//
// FileShed's own admin surface -- the only admin surface reachable from outside, since the better-auth admin endpoints
// are blocked at the mount (app.ts). Authentication (is there a session?) is answered here as a 401; authorization (is
// it an admin?) is the manager's, surfaced as a 403 through onError. The route depends on managers only.
//----------------------------------------------------------------------------------------------------------------------

import { Hono } from 'hono';

// Managers
import type { AdminManager } from '../managers/admin.ts';
import type { SessionManager } from '../managers/session.ts';

//----------------------------------------------------------------------------------------------------------------------

export function createAdminRoutes(sessions : SessionManager, admins : AdminManager) : Hono
{
    const router = new Hono();

    router.get('/users', async (ctx) =>
    {
        const actor = await sessions.getUser(ctx.req.raw.headers);
        if(!actor) { return ctx.json({ error: 'Unauthorized' }, 401); }

        const users = await admins.listUsers(actor, ctx.req.raw.headers);
        return ctx.json({ users });
    });

    return router;
}

//----------------------------------------------------------------------------------------------------------------------
