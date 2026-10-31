//----------------------------------------------------------------------------------------------------------------------
// Me Route
//
// GET /api/me is readable with an account:read token, so a status-bar script can watch its quota. Everything that
// changes the account is session-only: an account is closed by the person sitting at it, never by a credential that
// person left lying in a script.
//----------------------------------------------------------------------------------------------------------------------

import { Hono } from 'hono';

// Models
import { permissionDemands, updatePreferencesRequestCodec } from '@fileshed/core';

// Managers
import type { AccountDeletionManager } from '../../../managers/accountDeletion.ts';
import type { SessionManager } from '../../../managers/session.ts';
import type { UserManager } from '../../../managers/user.ts';

// Routes
import {
    cancelAccountDeletionSpec,
    meSpec,
    requestAccountDeletionSpec,
    updatePreferencesSpec,
} from './me.openapi.ts';
import { readJSONBody } from '../utils/readJSONBody.ts';

//----------------------------------------------------------------------------------------------------------------------

export function createMeRoutes(
    sessions : SessionManager,
    users : UserManager,
    deletions : AccountDeletionManager
) : Hono
{
    const router = new Hono();

    router.get('/me', meSpec, async (ctx) =>
    {
        const actor = await sessions.requireActor(
            ctx.req.raw.headers,
            permissionDemands.accountRead,
            { allowClosing: true }
        );

        return ctx.json(await users.me(actor.user));
    });

    router.patch('/me/preferences', updatePreferencesSpec, async (ctx) =>
    {
        const user = await sessions.requireUser(ctx.req.raw.headers);
        const patch = await readJSONBody(ctx, updatePreferencesRequestCodec);

        return ctx.json(await users.updatePreferences(user, patch));
    });

    router.post('/me/deletion', requestAccountDeletionSpec, async (ctx) =>
    {
        const user = await sessions.requireUser(ctx.req.raw.headers, { allowClosing: true });

        await deletions.request(user);

        return ctx.json(await users.me(user));
    });

    router.delete('/me/deletion', cancelAccountDeletionSpec, async (ctx) =>
    {
        const user = await sessions.requireUser(ctx.req.raw.headers, { allowClosing: true });

        await deletions.cancel(user);

        return ctx.json(await users.me(user));
    });

    return router;
}

//----------------------------------------------------------------------------------------------------------------------
