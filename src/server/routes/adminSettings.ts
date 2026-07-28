//----------------------------------------------------------------------------------------------------------------------
// Admin Settings Routes
//
// The admin's read/patch surface over the instance settings. Session-only like every admin route -- tokens never
// reach here -- with the role check at the manager boundary. A patch answers the refreshed view, so the UI never
// needs a second round trip to see what it changed.
//----------------------------------------------------------------------------------------------------------------------

import { Hono } from 'hono';

// Models
import { patchSettingsRequestCodec } from '@fileshed/core';

// Managers
import type { SessionManager } from '../managers/session.ts';
import type { SettingsManager } from '../managers/settings.ts';

// Routes
import { getSettingsSpec, patchSettingsSpec } from './adminSettings.openapi.ts';
import { readJsonBody } from './readJsonBody.ts';

//----------------------------------------------------------------------------------------------------------------------

export function createAdminSettingsRoutes(sessions : SessionManager, settings : SettingsManager) : Hono
{
    const router = new Hono();

    router.get('/admin/settings', getSettingsSpec, async (ctx) =>
    {
        const actor = await sessions.requireUser(ctx.req.raw.headers);

        return ctx.json(await settings.adminView(actor));
    });

    router.patch('/admin/settings', patchSettingsSpec, async (ctx) =>
    {
        const actor = await sessions.requireUser(ctx.req.raw.headers);
        const request = await readJsonBody(ctx, patchSettingsRequestCodec);

        return ctx.json(await settings.patch(actor, request));
    });

    return router;
}

//----------------------------------------------------------------------------------------------------------------------
