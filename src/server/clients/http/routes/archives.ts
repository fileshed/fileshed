//----------------------------------------------------------------------------------------------------------------------
// Archive Route
//
// The ids ride the query string of a GET because the browser downloads by navigating: a POST would have to be fetched,
// and a fetched archive has to be held whole in memory before it can be saved, which is the thing streaming it exists
// to avoid.
//
// Same credential plane as the single-file download, and the same demand: an archive is a download of several things,
// not a new capability.
//----------------------------------------------------------------------------------------------------------------------

import { Hono } from 'hono';

// Models
import { archiveQueryCodec, permissionDemands } from '@fileshed/core';

// Managers
import type { ArchiveManager } from '../../../managers/archive.ts';
import type { SessionManager } from '../../../managers/session.ts';

// Routes
import { archiveSpec } from './archives.openapi.ts';
import { contentDisposition } from '../utils/contentDisposition.ts';
import { parseQuery } from '../utils/parseQuery.ts';
import { streamResponse } from '../utils/streamResponse.ts';

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
        const archive = await archives.build(actor.user, query);

        // No content-length: the size is not known until the archive has been built, which is the point of building
        // it as it is sent. Always a 200, since an archive has no ranges to satisfy and no etag to match.
        return streamResponse(200, {
            'content-type': archive.contentType,
            'content-disposition': contentDisposition('attachment', archive.filename),
            'cache-control': 'private, no-store',
        }, archive.stream);
    });

    return router;
}

//----------------------------------------------------------------------------------------------------------------------
