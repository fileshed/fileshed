//----------------------------------------------------------------------------------------------------------------------
// User Routes
//
// GET /api/users/lookup?email=<exact> -- resolve an exact email to a UserSummary, authenticated. Resolves the caller
// through the session manager (401 when absent) and validates the query against the core DTO codec (400 on a blank or
// malformed email); the manager does the exact-match resolution and 404s an unknown email. Exact match only, so the
// endpoint cannot enumerate accounts.
//----------------------------------------------------------------------------------------------------------------------

import { Hono } from 'hono';

// Models
import { userLookupQueryCodec } from '@fileshed/core';

// Managers
import type { SessionManager } from '../managers/session.ts';
import type { UserManager } from '../managers/user.ts';

// Routes
import { parseQuery } from './parseQuery.ts';
import { lookupUserSpec } from './users.openapi.ts';

//----------------------------------------------------------------------------------------------------------------------

export function createUserRoutes(sessions : SessionManager, users : UserManager) : Hono
{
    const router = new Hono();

    router.get('/users/lookup', lookupUserSpec, async (ctx) =>
    {
        await sessions.requireUser(ctx.req.raw.headers);
        const query = parseQuery(ctx, userLookupQueryCodec);

        return ctx.json(await users.lookupByEmail(query.email));
    });

    return router;
}

//----------------------------------------------------------------------------------------------------------------------
