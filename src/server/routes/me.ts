//----------------------------------------------------------------------------------------------------------------------
// Me Route
//
// GET /api/me: the caller's own profile plus live quota usage and preferences -- readable with an account:read
// token, so a status-bar script can watch its quota. PATCH /api/me/preferences stays session-only: no token
// mutates account state. The node manager assembles the profile and computes usage fresh from owned file nodes.
//
// The two deletion routes are the whole self-service road to closing an account, and both are session-only for the
// same reason: an account is closed by the person sitting at it, never by a credential that person left lying in a
// script. Both answer the refreshed profile, so a client learns the new schedule from the same shape it already
// reads.
//----------------------------------------------------------------------------------------------------------------------

import { Hono } from 'hono';

// Models
import { permissionDemands, updatePreferencesRequestCodec } from '@fileshed/core';

// Managers
import type { AccountDeletionManager } from '../managers/accountDeletion.ts';
import type { NodeManager } from '../managers/node.ts';
import type { SessionManager } from '../managers/session.ts';

// Routes
import {
    cancelAccountDeletionSpec,
    meSpec,
    requestAccountDeletionSpec,
    updatePreferencesSpec,
} from './me.openapi.ts';
import { readJsonBody } from './readJsonBody.ts';

//----------------------------------------------------------------------------------------------------------------------

export function createMeRoutes(
    sessions : SessionManager,
    nodes : NodeManager,
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

        return ctx.json(await nodes.me(actor.user));
    });

    router.patch('/me/preferences', updatePreferencesSpec, async (ctx) =>
    {
        const actor = await sessions.requireUser(ctx.req.raw.headers);
        const patch = await readJsonBody(ctx, updatePreferencesRequestCodec);

        return ctx.json(await nodes.updatePreferences(actor, patch));
    });

    router.post('/me/deletion', requestAccountDeletionSpec, async (ctx) =>
    {
        const actor = await sessions.requireUser(ctx.req.raw.headers, { allowClosing: true });

        await deletions.request(actor);

        return ctx.json(await nodes.me(actor));
    });

    router.delete('/me/deletion', cancelAccountDeletionSpec, async (ctx) =>
    {
        const actor = await sessions.requireUser(ctx.req.raw.headers, { allowClosing: true });

        await deletions.cancel(actor);

        return ctx.json(await nodes.me(actor));
    });

    return router;
}

//----------------------------------------------------------------------------------------------------------------------
