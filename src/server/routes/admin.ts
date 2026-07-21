//----------------------------------------------------------------------------------------------------------------------
// Admin Routes
//
// FileShed's own admin surface -- the only admin surface reachable from outside, since the better-auth admin endpoints
// are blocked at the mount (app.ts). Both authentication (is there a session? -> 401) and authorization (is it an
// admin? -> 403) are manager-produced errors, mapped to their status codes by onError -- the route composes managers
// and carries no error-shape logic of its own.
//----------------------------------------------------------------------------------------------------------------------

import { Hono } from 'hono';

// Models
import { setQuotaRequestCodec } from '@fileshed/core';

// Managers
import type { AdminManager } from '../managers/admin.ts';
import type { SessionManager } from '../managers/session.ts';
import type { StatusManager } from '../managers/status.ts';

// Routes
import { readJsonBody } from './readJsonBody.ts';

//----------------------------------------------------------------------------------------------------------------------

// Malformed or absent limit/offset fall back to the manager's own default rather than failing the request -- listUsers
// clamps whatever it's given, so there's nothing here worth rejecting on.
function paginationParam(value : string | undefined) : number | undefined
{
    if(value === undefined) { return undefined; }

    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
}

//----------------------------------------------------------------------------------------------------------------------

export function createAdminRoutes(sessions : SessionManager, admins : AdminManager) : Hono
{
    const router = new Hono();

    router.get('/admin/users', async (ctx) =>
    {
        const actor = await sessions.requireUser(ctx.req.raw.headers);

        const page = await admins.listUsers(actor, ctx.req.raw.headers, {
            limit: paginationParam(ctx.req.query('limit')),
            offset: paginationParam(ctx.req.query('offset')),
        });

        return ctx.json(page);
    });

    router.patch('/admin/users/:id', async (ctx) =>
    {
        const actor = await sessions.requireUser(ctx.req.raw.headers);
        const body = await readJsonBody(ctx, setQuotaRequestCodec);

        const profile = await admins.setQuota(actor, ctx.req.raw.headers, ctx.req.param('id'), body.quotaLimit);

        return ctx.json(profile);
    });

    return router;
}

//----------------------------------------------------------------------------------------------------------------------

// The status readout is admin surface too, but unlike user management it needs the full runtime graph (the blob RA and
// the sweep tracker), so it composes separately -- mounted only alongside the feature services, never in the auth-only
// smoke app. Same session gate (401) then admin gate (403), both manager-produced and mapped by onError.
export function createAdminStatusRoutes(sessions : SessionManager, status : StatusManager) : Hono
{
    const router = new Hono();

    router.get('/admin/status', async (ctx) =>
    {
        const actor = await sessions.requireUser(ctx.req.raw.headers);

        return ctx.json(await status.status(actor));
    });

    return router;
}

//----------------------------------------------------------------------------------------------------------------------
