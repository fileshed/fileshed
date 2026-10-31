//----------------------------------------------------------------------------------------------------------------------
// Search Routes
//----------------------------------------------------------------------------------------------------------------------

import { Hono } from 'hono';

// Models
import { permissionDemands, searchQueryCodec } from '@fileshed/core';

// Managers
import type { NodeManager } from '../../../managers/node.ts';
import type { SessionManager } from '../../../managers/session.ts';

// Routes
import { parseQuery } from '../utils/parseQuery.ts';
import { searchSpec } from './search.openapi.ts';

//----------------------------------------------------------------------------------------------------------------------

export function createSearchRoutes(sessions : SessionManager, nodes : NodeManager) : Hono
{
    const router = new Hono();

    router.get('/search', searchSpec, async (ctx) =>
    {
        const actor = await sessions.requireActor(ctx.req.raw.headers, permissionDemands.filesRead);
        const query = parseQuery(ctx, searchQueryCodec);

        return ctx.json(await nodes.search(actor, query));
    });

    return router;
}

//----------------------------------------------------------------------------------------------------------------------
