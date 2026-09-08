//----------------------------------------------------------------------------------------------------------------------
// Archive Route
//
// GET /api/archives -- a selection served back as one archive. A GET with the ids in the query string because the
// browser downloads by navigating: a POST would have to be fetched, and a fetched archive has to be held whole in
// memory before it can be saved, which is the thing streaming it exists to avoid.
//
// Same credential plane as the single-file download, and the same demand: an archive is a download of several things,
// not a new capability.
//----------------------------------------------------------------------------------------------------------------------

import { Hono } from 'hono';

// Models
import { archiveQueryCodec, permissionDemands } from '@fileshed/core';

// Managers
import type { ArchiveManager } from '../managers/archive.ts';
import type { SessionManager } from '../managers/session.ts';

// Routes
import { archiveSpec } from './archives.openapi.ts';
import { parseQuery } from './parseQuery.ts';
import { streamResponse } from './streamResponse.ts';

//----------------------------------------------------------------------------------------------------------------------

export function createArchiveRoutes(sessions : SessionManager, archives : ArchiveManager) : Hono
{
    const router = new Hono();

    router.get('/archives', archiveSpec, async (ctx) =>
    {
        const actor = await sessions.resolveActor(
            { kind: 'request', headers: ctx.req.raw.headers, urlToken: ctx.req.query('token') ?? null },
            permissionDemands.filesDownload
        );

        const query = parseQuery(ctx, archiveQueryCodec);
        const result = await archives.build(actor.user, query);

        return streamResponse(result, { 'cache-control': 'private, no-store' });
    });

    return router;
}

//----------------------------------------------------------------------------------------------------------------------
