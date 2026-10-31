//----------------------------------------------------------------------------------------------------------------------
// Admin Routes
//
// The only admin surface reachable from outside: better-auth's own admin endpoints are blocked at the mount
// (middleware/authGate.ts).
//----------------------------------------------------------------------------------------------------------------------

import { Hono } from 'hono';

// Models
import {
    adminUserListQueryCodec,
    banUserRequestCodec,
    setPasswordRequestCodec,
    setQuotaRequestCodec,
    setRoleRequestCodec,
} from '@fileshed/core';

// Managers
import type { AdminManager } from '../../../managers/admin.ts';
import type { SessionManager } from '../../../managers/session.ts';
import type { StatusManager } from '../../../managers/status.ts';
import type { SweepManager } from '../../../managers/sweeps.ts';

// Routes
import {
    adminStatusSpec,
    banUserSpec,
    deleteUserSpec,
    listUsersSpec,
    revokeSessionsSpec,
    runSweepSpec,
    setPasswordSpec,
    setQuotaSpec,
    setRoleSpec,
    unbanUserSpec,
} from './admin.openapi.ts';
import { parseQuery } from '../utils/parseQuery.ts';
import { readJSONBody } from '../utils/readJSONBody.ts';

//----------------------------------------------------------------------------------------------------------------------

export function createAdminRoutes(sessions : SessionManager, admins : AdminManager) : Hono
{
    const router = new Hono();

    router.get('/admin/users', listUsersSpec, async (ctx) =>
    {
        const user = await sessions.requireUser(ctx.req.raw.headers);

        return ctx.json(await admins.listUsers(user, parseQuery(ctx, adminUserListQueryCodec)));
    });

    router.patch('/admin/users/:id', setQuotaSpec, async (ctx) =>
    {
        const user = await sessions.requireUser(ctx.req.raw.headers);
        const body = await readJSONBody(ctx, setQuotaRequestCodec);

        return ctx.json(await admins.setQuota(user, ctx.req.raw.headers, ctx.req.param('id'), body.quotaLimit));
    });

    router.post('/admin/users/:id/ban', banUserSpec, async (ctx) =>
    {
        const user = await sessions.requireUser(ctx.req.raw.headers);
        const body = await readJSONBody(ctx, banUserRequestCodec);

        return ctx.json(await admins.ban(user, ctx.req.raw.headers, ctx.req.param('id'), body));
    });

    router.post('/admin/users/:id/unban', unbanUserSpec, async (ctx) =>
    {
        const user = await sessions.requireUser(ctx.req.raw.headers);

        return ctx.json(await admins.unban(user, ctx.req.raw.headers, ctx.req.param('id')));
    });

    router.post('/admin/users/:id/role', setRoleSpec, async (ctx) =>
    {
        const user = await sessions.requireUser(ctx.req.raw.headers);
        const body = await readJSONBody(ctx, setRoleRequestCodec);

        return ctx.json(await admins.setRole(user, ctx.req.raw.headers, ctx.req.param('id'), body.role));
    });

    router.post('/admin/users/:id/password', setPasswordSpec, async (ctx) =>
    {
        const user = await sessions.requireUser(ctx.req.raw.headers);
        const body = await readJSONBody(ctx, setPasswordRequestCodec);

        await admins.setPassword(user, ctx.req.raw.headers, ctx.req.param('id'), body.password);

        return ctx.body(null, 204);
    });

    router.post('/admin/users/:id/revoke-sessions', revokeSessionsSpec, async (ctx) =>
    {
        const user = await sessions.requireUser(ctx.req.raw.headers);

        await admins.revokeSessions(user, ctx.req.raw.headers, ctx.req.param('id'));

        return ctx.body(null, 204);
    });

    router.delete('/admin/users/:id', deleteUserSpec, async (ctx) =>
    {
        const user = await sessions.requireUser(ctx.req.raw.headers);

        await admins.deleteUser(user, ctx.req.param('id'));

        return ctx.body(null, 204);
    });

    return router;
}

//----------------------------------------------------------------------------------------------------------------------

// AdminManager. Same session check (401) then admin check (403), both manager-produced and mapped by onError.
export function createAdminRuntimeRoutes(
    sessions : SessionManager,
    status : StatusManager,
    sweeps : SweepManager
) : Hono
{
    const router = new Hono();

    router.get('/admin/status', adminStatusSpec, async (ctx) =>
    {
        const user = await sessions.requireUser(ctx.req.raw.headers);

        return ctx.json(await status.status(user));
    });

    // The response is deliberately the sweep's own summary rather than 202-and-poll: the sweep is bounded work the
    // admin just asked for, and an answer they have to go looking for is the thing this endpoint exists to fix. An
    // unknown sweep name and a sweep already running are both the manager's to judge -- the route only names the
    // caller and the sweep.
    router.post('/admin/sweeps/:sweep/run', runSweepSpec, async (ctx) =>
    {
        const user = await sessions.requireUser(ctx.req.raw.headers);

        return ctx.json(await sweeps.run(user, ctx.req.param('sweep')));
    });

    return router;
}

//----------------------------------------------------------------------------------------------------------------------
