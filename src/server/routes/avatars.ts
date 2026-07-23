//----------------------------------------------------------------------------------------------------------------------
// Avatar Routes
//
// POST /api/me/avatar streams a raw image body into the blob store and points the caller at it, answering the refreshed
// profile. DELETE /api/me/avatar clears it (204). GET /api/avatars/:sha256 serves an avatar's bytes -- authenticated,
// and only for a hash some user's avatar actually references (the manager's serve gate), so it never becomes an oracle
// for pulling arbitrary dedup-store content by hash. Thin over the manager; onError maps the typed errors.
//----------------------------------------------------------------------------------------------------------------------

import { Hono } from 'hono';

import { Readable } from 'node:stream';
import type { ReadableStream as NodeReadableStream } from 'node:stream/web';

// Models
import { BadRequestError, NotFoundError } from '@fileshed/core';

// Managers
import type { AvatarManager } from '../managers/avatar.ts';
import type { NodeManager } from '../managers/node.ts';
import type { SessionManager } from '../managers/session.ts';

// Routes
import { deleteAvatarSpec, getAvatarSpec, uploadAvatarSpec } from './avatars.openapi.ts';

//----------------------------------------------------------------------------------------------------------------------

// One year, the max-age the immutable content-addressed bytes are cached for. private: an avatar is served only to an
// authenticated caller, so it must not land in a shared cache.
const AVATAR_CACHE_CONTROL = 'private, immutable, max-age=31536000';

// A declared Content-Length, when present and well-formed -- an early-reject hint before the body streams. The manager
// still enforces the true byte count, so a missing or lying header only loses the early exit.
function parseContentLength(header : string | undefined) : number | undefined
{
    if(header === undefined) { return undefined; }

    const value = Number(header);
    return Number.isInteger(value) && value >= 0 ? value : undefined;
}

//----------------------------------------------------------------------------------------------------------------------

export function createAvatarRoutes(sessions : SessionManager, avatars : AvatarManager, nodes : NodeManager) : Hono
{
    const router = new Hono();

    router.post('/me/avatar', uploadAvatarSpec, async (ctx) =>
    {
        const actor = await sessions.requireUser(ctx.req.raw.headers);

        const body = ctx.req.raw.body;
        if(body === null) { throw new BadRequestError('An avatar body is required.'); }

        await avatars.setAvatar(
            actor.id,
            Readable.fromWeb(body as NodeReadableStream<Uint8Array>),
            ctx.req.header('content-type'),
            parseContentLength(ctx.req.header('content-length'))
        );

        return ctx.json(await nodes.me(actor));
    });

    router.delete('/me/avatar', deleteAvatarSpec, async (ctx) =>
    {
        const actor = await sessions.requireUser(ctx.req.raw.headers);

        await avatars.deleteAvatar(actor.id);

        return ctx.body(null, 204);
    });

    router.get('/avatars/:sha256', getAvatarSpec, async (ctx) =>
    {
        await sessions.requireUser(ctx.req.raw.headers);

        const served = await avatars.serveAvatar(ctx.req.param('sha256'));
        if(served === null) { throw new NotFoundError('No avatar at this hash.'); }

        return new Response(Readable.toWeb(served.stream) as BodyInit, {
            status: 200,
            headers: {
                'content-type': served.mime,
                'content-length': String(served.size),
                'cache-control': AVATAR_CACHE_CONTROL,
            },
        });
    });

    return router;
}

//----------------------------------------------------------------------------------------------------------------------
