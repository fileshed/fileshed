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
import { type SocialProviderID, setupRequestCodec } from '@fileshed/core';

// Managers
import type { SetupManager } from '../managers/setup.ts';

// Routes
import { instanceSpec, setupSpec } from './setup.openapi.ts';
import { readJsonBody } from './readJsonBody.ts';

//----------------------------------------------------------------------------------------------------------------------

// What /api/instance reports beside the setup gate: the live sign-up and email switches, and the provider list
// this process froze in at boot.
export interface InstanceFacts
{
    signUpEnabled : () => Promise<boolean>;
    emailEnabled : () => Promise<boolean>;
    providers : SocialProviderID[];
}

export function createSetupRoutes(setup : SetupManager, facts : InstanceFacts) : Hono
{
    const router = new Hono();

    router.get('/instance', instanceSpec, async (ctx) =>
    {
        const [ needsSetup, signUp, email ] = await Promise.all([
            setup.needsSetup(),
            facts.signUpEnabled(),
            facts.emailEnabled(),
        ]);

        return ctx.json({ needsSetup, signUpEnabled: signUp, emailEnabled: email, providers: facts.providers });
    });

    router.post('/setup', setupSpec, async (ctx) =>
    {
        const request = await readJsonBody(ctx, setupRequestCodec);

        return ctx.json(await setup.complete(request));
    });

    return router;
}

//----------------------------------------------------------------------------------------------------------------------
