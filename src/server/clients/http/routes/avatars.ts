//----------------------------------------------------------------------------------------------------------------------
// Avatar Routes
//
// An avatar's bytes are served only for a hash some user's avatar references, so the route never becomes an oracle for
// arbitrary content in the shared blob store.
//----------------------------------------------------------------------------------------------------------------------

import { Hono } from 'hono';

import { Readable } from 'node:stream';

// Managers
import type { AvatarManager } from '../../../managers/avatar.ts';
import type { SessionManager } from '../../../managers/session.ts';
import type { UserManager } from '../../../managers/user.ts';

// Routes
import { deleteAvatarSpec, getAvatarSpec, uploadAvatarSpec } from './avatars.openapi.ts';
import { readByteBody } from '../utils/readByteBody.ts';
import { USER_CONTENT_HEADERS } from '../utils/userContentHeaders.ts';

//----------------------------------------------------------------------------------------------------------------------

// One year, the max-age the immutable content-addressed bytes are cached for. private: an avatar is served only to an
// authenticated caller, so it must not land in a shared cache.
const AVATAR_CACHE_CONTROL = 'private, immutable, max-age=31536000';

//----------------------------------------------------------------------------------------------------------------------

export function createAvatarRoutes(sessions : SessionManager, avatars : AvatarManager, users : UserManager) : Hono
{
    const router = new Hono();

    router.post('/me/avatar', uploadAvatarSpec, async (ctx) =>
    {
        const user = await sessions.requireUser(ctx.req.raw.headers);

        const { stream, contentLength, mediaType } = readByteBody(ctx, 'An avatar body is required.');

        await avatars.setAvatar(user.id, stream, mediaType, contentLength);

        return ctx.json(await users.me(user));
    });

    router.delete('/me/avatar', deleteAvatarSpec, async (ctx) =>
    {
        const user = await sessions.requireUser(ctx.req.raw.headers);

        await avatars.deleteAvatar(user.id);

        return ctx.json(await users.me(user));
    });

    router.get('/avatars/:sha256', getAvatarSpec, async (ctx) =>
    {
        await sessions.requireUser(ctx.req.raw.headers);

        const served = await avatars.serveAvatar(ctx.req.param('sha256'));

        return new Response(Readable.toWeb(served.stream) as BodyInit, {
            status: 200,
            headers: {
                ...USER_CONTENT_HEADERS,
                'content-type': served.mime,
                'content-length': String(served.size),
                'cache-control': AVATAR_CACHE_CONTROL,
            },
        });
    });

    return router;
}

//----------------------------------------------------------------------------------------------------------------------
