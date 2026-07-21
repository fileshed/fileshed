//----------------------------------------------------------------------------------------------------------------------
// Search Routes
//
// GET /api/search -- a name match scoped to the nodes the caller can access. Resolves the caller through the session
// manager (401 when absent) and validates the query against the core DTO codec (400 on a blank/malformed query); the
// manager does the accessibility scoping and returns the ordinary paginated node envelope. The route composes managers
// and carries no error-shape or business logic of its own.
//----------------------------------------------------------------------------------------------------------------------

import { Hono } from 'hono';

// Models
import { searchQueryCodec } from '@fileshed/core';

// Managers
import type { NodeManager } from '../managers/node.ts';
import type { SessionManager } from '../managers/session.ts';

// Routes
import { parseQuery } from './parseQuery.ts';

//----------------------------------------------------------------------------------------------------------------------

export function createSearchRoutes(sessions : SessionManager, nodes : NodeManager) : Hono
{
    const router = new Hono();

    router.get('/search', async (ctx) =>
    {
        const actor = await sessions.requireUser(ctx.req.raw.headers);
        const query = parseQuery(ctx, searchQueryCodec);

        return ctx.json(await nodes.search(actor, query));
    });

    return router;
}

//----------------------------------------------------------------------------------------------------------------------
