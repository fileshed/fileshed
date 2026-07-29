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
import {
    type AdminUserSearchField,
    type AdminUserSortKey,
    adminUserSearchFields,
    adminUserSortKeys,
    banUserRequestCodec,
    setPasswordRequestCodec,
    setQuotaRequestCodec,
    setRoleRequestCodec,
    toAdminUserPageResponse,
    toAdminUserResponse,
} from '@fileshed/core';

// Managers
import type { AdminManager } from '../managers/admin.ts';
import type { SessionManager } from '../managers/session.ts';
import type { StatusManager } from '../managers/status.ts';

// Routes
import {
    adminStatusSpec,
    banUserSpec,
    listUsersSpec,
    revokeSessionsSpec,
    setPasswordSpec,
    setQuotaSpec,
    setRoleSpec,
    unbanUserSpec,
} from './admin.openapi.ts';
import { readJsonBody } from './readJsonBody.ts';

//----------------------------------------------------------------------------------------------------------------------

// Malformed or absent listing options fall back to the manager's own defaults rather than failing the request --
// listUsers clamps and defaults whatever it's given, so there's nothing here worth rejecting on.
function paginationParam(value : string | undefined) : number | undefined
{
    if(value === undefined) { return undefined; }

    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
}

function vocabularyParam<T extends string>(value : string | undefined, vocabulary : readonly T[]) : T | undefined
{
    return (vocabulary as readonly string[]).includes(value ?? '') ? value as T : undefined;
}

//----------------------------------------------------------------------------------------------------------------------

export function createAdminRoutes(sessions : SessionManager, admins : AdminManager) : Hono
{
    const router = new Hono();

    router.get('/admin/users', listUsersSpec, async (ctx) =>
    {
        const actor = await sessions.requireUser(ctx.req.raw.headers);

        const search = ctx.req.query('search');
        const page = await admins.listUsers(actor, ctx.req.raw.headers, {
            limit: paginationParam(ctx.req.query('limit')),
            offset: paginationParam(ctx.req.query('offset')),
            ...search === undefined || search === '' ? {} : { search },
            searchField: vocabularyParam<AdminUserSearchField>(ctx.req.query('searchField'), adminUserSearchFields),
            sortBy: vocabularyParam<AdminUserSortKey>(ctx.req.query('sortBy'), adminUserSortKeys),
            sortDirection: vocabularyParam(ctx.req.query('sortDirection'), [ 'asc', 'desc' ] as const),
        });

        return ctx.json(toAdminUserPageResponse(page));
    });

    router.patch('/admin/users/:id', setQuotaSpec, async (ctx) =>
    {
        const actor = await sessions.requireUser(ctx.req.raw.headers);
        const body = await readJsonBody(ctx, setQuotaRequestCodec);

        const entry = await admins.setQuota(actor, ctx.req.raw.headers, ctx.req.param('id'), body.quotaLimit);

        return ctx.json(toAdminUserResponse(entry));
    });

    router.post('/admin/users/:id/ban', banUserSpec, async (ctx) =>
    {
        const actor = await sessions.requireUser(ctx.req.raw.headers);
        const body = await readJsonBody(ctx, banUserRequestCodec);

        const entry = await admins.ban(actor, ctx.req.raw.headers, ctx.req.param('id'), body);

        return ctx.json(toAdminUserResponse(entry));
    });

    router.post('/admin/users/:id/unban', unbanUserSpec, async (ctx) =>
    {
        const actor = await sessions.requireUser(ctx.req.raw.headers);

        const entry = await admins.unban(actor, ctx.req.raw.headers, ctx.req.param('id'));

        return ctx.json(toAdminUserResponse(entry));
    });

    router.post('/admin/users/:id/role', setRoleSpec, async (ctx) =>
    {
        const actor = await sessions.requireUser(ctx.req.raw.headers);
        const body = await readJsonBody(ctx, setRoleRequestCodec);

        const entry = await admins.setRole(actor, ctx.req.raw.headers, ctx.req.param('id'), body.role);

        return ctx.json(toAdminUserResponse(entry));
    });

    router.post('/admin/users/:id/password', setPasswordSpec, async (ctx) =>
    {
        const actor = await sessions.requireUser(ctx.req.raw.headers);
        const body = await readJsonBody(ctx, setPasswordRequestCodec);

        await admins.setPassword(actor, ctx.req.raw.headers, ctx.req.param('id'), body.password);

        return ctx.body(null, 204);
    });

    router.post('/admin/users/:id/revoke-sessions', revokeSessionsSpec, async (ctx) =>
    {
        const actor = await sessions.requireUser(ctx.req.raw.headers);

        await admins.revokeSessions(actor, ctx.req.raw.headers, ctx.req.param('id'));

        return ctx.body(null, 204);
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

    router.get('/admin/status', adminStatusSpec, async (ctx) =>
    {
        const actor = await sessions.requireUser(ctx.req.raw.headers);

        return ctx.json(await status.status(actor));
    });

    return router;
}

//----------------------------------------------------------------------------------------------------------------------
