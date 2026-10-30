//----------------------------------------------------------------------------------------------------------------------
// User Routes
//
// The lookup demands shares:write despite being a read: its only purpose is the grant flow, so gating it there keeps
// whatever account disclosure it allows limited to credentials that could already grant. Exact match only, so it cannot
// enumerate accounts.
//----------------------------------------------------------------------------------------------------------------------

import { Hono } from 'hono';

// Models
import { permissionDemands, userLookupQueryCodec } from '@fileshed/core';

// Managers
import type { SessionManager } from '../../../managers/session.ts';
import type { UserManager } from '../../../managers/user.ts';

// Routes
import { parseQuery } from '../utils/parseQuery.ts';
import { lookupUserSpec } from './users.openapi.ts';

//----------------------------------------------------------------------------------------------------------------------

export function createUserRoutes(sessions : SessionManager, users : UserManager) : Hono
{
    const router = new Hono();

    router.get('/users/lookup', lookupUserSpec, async (ctx) =>
    {
        await sessions.requireActor(ctx.req.raw.headers, permissionDemands.sharesWrite);
        const query = parseQuery(ctx, userLookupQueryCodec);

        return ctx.json(await users.getByEmail(query.email));
    });

    return router;
}

//----------------------------------------------------------------------------------------------------------------------
