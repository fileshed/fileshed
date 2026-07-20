//----------------------------------------------------------------------------------------------------------------------
// Admin Route — GET /api/admin/users
//
// The vertical slice proving the gated pattern end to end: route -> manager -> role check -> server-side auth.api. This
// is the template future admin routes copy, so the authn (401) / authz (403) / success (200) contract is pinned here.
//----------------------------------------------------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';
import type { Hono } from 'hono';

// Support
import { ORIGIN, bootTestApp, cookieFrom, makeAdmin, signUp } from './support.ts';

//----------------------------------------------------------------------------------------------------------------------

function listUsers(app : Hono, cookie ?: string, query : Record<string, string> = {}) : Promise<Response>
{
    const search = new URLSearchParams(query).toString();
    const url = `${ ORIGIN }/api/admin/users${ search ? `?${ search }` : '' }`;

    return app.request(url, cookie ? { headers: { cookie } } : undefined);
}

//----------------------------------------------------------------------------------------------------------------------

describe('GET /api/admin/users', () =>
{
    it('rejects an anonymous request with 401', async () =>
    {
        const booted = await bootTestApp();

        const res = await listUsers(booted.app);

        expect(res.status).toBe(401);
        expect(await res.json()).toHaveProperty('error');
    });

    it('rejects a signed-in non-admin with 403', async () =>
    {
        const booted = await bootTestApp();
        const cookie = cookieFrom(await signUp(booted.app, 'member@example.com', 'correct-horse-battery'));

        const res = await listUsers(booted.app, cookie);

        expect(res.status).toBe(403);
        expect(await res.json()).toHaveProperty('error');
    });

    it('returns the user list to an admin with 200', async () =>
    {
        const booted = await bootTestApp();
        await signUp(booted.app, 'member@example.com', 'correct-horse-battery');
        const adminCookie = await makeAdmin(booted, 'root@example.com', 'correct-horse-battery');

        const res = await listUsers(booted.app, adminCookie);
        const body = await res.json();

        expect(res.status).toBe(200);
        expect(Array.isArray(body.users)).toBe(true);
        const emails = body.users.map((user : { email : string }) => user.email);
        expect(emails).toContain('root@example.com');
        expect(emails).toContain('member@example.com');
    });

    it('reports the total user count and the applied default page bounds', async () =>
    {
        const booted = await bootTestApp();
        await signUp(booted.app, 'member@example.com', 'correct-horse-battery');
        const adminCookie = await makeAdmin(booted, 'root@example.com', 'correct-horse-battery');

        const res = await listUsers(booted.app, adminCookie);
        const body = await res.json();

        expect(body.total).toBe(2);
        expect(body.limit).toBe(50);
        expect(body.offset).toBe(0);
    });

    it('clamps a limit over the manager bound instead of rejecting the request', async () =>
    {
        const booted = await bootTestApp();
        const adminCookie = await makeAdmin(booted, 'root@example.com', 'correct-horse-battery');

        const res = await listUsers(booted.app, adminCookie, { limit: '99999' });
        const body = await res.json();

        expect(res.status).toBe(200);
        expect(body.limit).toBe(100);
    });
});

//----------------------------------------------------------------------------------------------------------------------
