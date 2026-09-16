//----------------------------------------------------------------------------------------------------------------------
// Version Route
//
// Session-only, unlike /api/instance: a version number tells whoever reads it which published vulnerabilities apply
// to this instance, so an anonymous visitor does not get it.
//----------------------------------------------------------------------------------------------------------------------

import { Hono } from 'hono';

// Managers
import type { SessionManager } from '../managers/session.ts';

// Routes
import { versionSpec } from './version.openapi.ts';

// Utils
import type { BuildInfo } from '../utils/version.ts';

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
