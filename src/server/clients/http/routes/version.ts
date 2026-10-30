//----------------------------------------------------------------------------------------------------------------------
// Version Route
//
// Session-only, unlike /api/instance. The release number is public -- the OpenAPI document states it to anyone -- but
// the commit and branch pin down exactly which build an instance runs, unreleased ones included, and that is for the
// people who use it.
//----------------------------------------------------------------------------------------------------------------------

import { Hono } from 'hono';

// Managers
import type { SessionManager } from '../../../managers/session.ts';

// Routes
import { versionSpec } from './version.openapi.ts';

// Utils
import type { BuildInfo } from '../../../utils/version.ts';

//----------------------------------------------------------------------------------------------------------------------

export function createVersionRoutes(sessions : SessionManager, build : BuildInfo) : Hono
{
    const router = new Hono();

    router.get('/version', versionSpec, async (ctx) =>
    {
        await sessions.requireUser(ctx.req.raw.headers);

        return ctx.json(build);
    });

    return router;
}

//----------------------------------------------------------------------------------------------------------------------
