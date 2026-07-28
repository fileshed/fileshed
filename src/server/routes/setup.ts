//----------------------------------------------------------------------------------------------------------------------
// Instance & Setup Routes
//
// Both anonymous by design. GET /api/instance is the pre-auth handshake -- the sign-in and setup pages need it
// before any session can exist -- and carries only facts safe in anyone's hands. POST /api/setup is the first-run
// wizard's single action, gated by the one-time code; once any account exists it answers 404 forever, from a live
// check, never a snapshot.
//----------------------------------------------------------------------------------------------------------------------

import { Hono } from 'hono';

// Models
import { setupRequestCodec } from '@fileshed/core';

// Managers
import type { SetupManager } from '../managers/setup.ts';

// Routes
import { instanceSpec, setupSpec } from './setup.openapi.ts';
import { readJsonBody } from './readJsonBody.ts';

//----------------------------------------------------------------------------------------------------------------------

export function createSetupRoutes(setup : SetupManager) : Hono
{
    const router = new Hono();

    router.get('/instance', instanceSpec, async (ctx) =>
    {
        return ctx.json({ needsSetup: await setup.needsSetup() });
    });

    router.post('/setup', setupSpec, async (ctx) =>
    {
        const request = await readJsonBody(ctx, setupRequestCodec);

        return ctx.json(await setup.complete(request));
    });

    return router;
}

//----------------------------------------------------------------------------------------------------------------------
