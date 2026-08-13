//----------------------------------------------------------------------------------------------------------------------
// Credential Routes
//
// Session-only, like every other account mutation: a stolen access token must not be able to lock its owner out of
// their own account.
//----------------------------------------------------------------------------------------------------------------------

import { Hono } from 'hono';

// Managers
import type { CredentialManager } from '../managers/credentials.ts';
import type { SessionManager } from '../managers/session.ts';

// Routes
import { revokeAllCredentialsSpec } from './credentials.openapi.ts';

//----------------------------------------------------------------------------------------------------------------------

export function createCredentialRoutes(sessions : SessionManager, credentials : CredentialManager) : Hono
{
    const router = new Hono();

    router.post('/me/revoke-credentials', revokeAllCredentialsSpec, async (ctx) =>
    {
        const actor = await sessions.requireUser(ctx.req.raw.headers);

        await credentials.revokeAll(actor, ctx.req.raw.headers);

        return ctx.body(null, 204);
    });

    return router;
}

//----------------------------------------------------------------------------------------------------------------------
