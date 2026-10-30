//----------------------------------------------------------------------------------------------------------------------
// Direct Link Route
//
// Mounted outside /api with no auth: the token is the capability. Responses are cacheable by anyone but always
// revalidated, so a revoked link stops serving everywhere at once; the content-hash ETag keeps revalidation a 304.
//----------------------------------------------------------------------------------------------------------------------

import { Hono } from 'hono';

// Models
import type { ContentDisposition } from '@fileshed/core';

// Managers
import type { PublicLinkManager } from '../../../managers/publicLink.ts';

// Routes
import { directSpec } from './direct.openapi.ts';
import { fileResponse } from '../utils/streamResponse.ts';

//----------------------------------------------------------------------------------------------------------------------

// The address renders its file where it lands -- being hotlinkable is the whole point of this route -- and ?download
// asks for the save-it form instead. The flag's presence is the entire switch: any value it carries is ignored. The
// token grants the bytes and says nothing about how a browser presents them, which could never be a boundary anyway:
// whoever can render a file inline can save it.
function readDisposition(download : string | undefined) : ContentDisposition
{
    return download === undefined ? 'inline' : 'attachment';
}

//----------------------------------------------------------------------------------------------------------------------

export function createDirectRoutes(links : PublicLinkManager) : Hono
{
    const router = new Hono();

    router.get('/:token', directSpec, async (ctx) =>
    {
        const file = await links.downloadByToken(ctx.req.param('token'));

        return fileResponse(file, {
            disposition: readDisposition(ctx.req.query('download')),
            rangeHeader: ctx.req.header('range'),
            ifNoneMatch: ctx.req.header('if-none-match'),
        }, { 'cache-control': 'public, no-cache' });
    });

    return router;
}

//----------------------------------------------------------------------------------------------------------------------
