//----------------------------------------------------------------------------------------------------------------------
// Auth — the admin-surface gate
//
// The security assertion of the gated-capability pattern: better-auth's /api/auth/admin/* endpoints must be
// unreachable from outside, EVEN with a valid admin session. If any variant leaks through, the whole plugin surface
// (ban, impersonate, set-role, delete) is exposed. These specs are the tripwire.
//----------------------------------------------------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';

// App
import { targetsAuthAdminSurface } from '@server/app.ts';

// Support
import { ORIGIN, bootTestApp, makeAdmin } from './support.ts';

//----------------------------------------------------------------------------------------------------------------------

describe('targetsAuthAdminSurface', () =>
{
    it('matches the admin prefix and its endpoints', () =>
    {
        expect(targetsAuthAdminSurface('/api/auth/admin')).toBe(true);
        expect(targetsAuthAdminSurface('/api/auth/admin/list-users')).toBe(true);
        expect(targetsAuthAdminSurface('/api/auth/admin/set-role')).toBe(true);
    });

    it('matches evasion variants: encoded slash, doubled slashes, trailing slash, uppercase', () =>
    {
        expect(targetsAuthAdminSurface('/api/auth/admin%2Flist-users')).toBe(true);
        expect(targetsAuthAdminSurface('/api/auth//admin/list-users')).toBe(true);
        expect(targetsAuthAdminSurface('/api/auth/admin/list-users/')).toBe(true);
        expect(targetsAuthAdminSurface('/api/auth/ADMIN/list-users')).toBe(true);
    });

    it('does not match the non-admin auth surface or lookalikes', () =>
    {
        expect(targetsAuthAdminSurface('/api/auth/get-session')).toBe(false);
        expect(targetsAuthAdminSurface('/api/auth/sign-in/email')).toBe(false);
        expect(targetsAuthAdminSurface('/api/auth/administrator')).toBe(false);
        expect(targetsAuthAdminSurface('/api/health')).toBe(false);
    });
});

//----------------------------------------------------------------------------------------------------------------------

describe('admin HTTP surface', () =>
{
    const variants : { method : string; path : string; body ?: string }[]
        = [
            { method: 'GET', path: '/api/auth/admin/list-users' },
            { method: 'POST', path: '/api/auth/admin/list-users', body: '{}' },
            { method: 'POST', path: '/api/auth/admin/set-role', body: '{}' },
            { method: 'POST', path: '/api/auth/admin/ban-user', body: '{}' },
            { method: 'POST', path: '/api/auth/admin/impersonate-user', body: '{}' },
            { method: 'DELETE', path: '/api/auth/admin/remove-user', body: '{}' },
            { method: 'POST', path: '/api/auth//admin/list-users', body: '{}' },
            { method: 'POST', path: '/api/auth/admin%2Flist-users', body: '{}' },
            { method: 'POST', path: '/api/auth/admin/list-users/', body: '{}' },
            { method: 'GET', path: '/api/auth/ADMIN/list-users' },
        ];

    it('answers 404 with our JSON shape for every variant, even carrying a valid admin session', async () =>
    {
        const booted = await bootTestApp();
        const cookie = await makeAdmin(booted, 'root@example.com', 'correct-horse-battery');

        await Promise.all(variants.map(async (variant) =>
        {
            const init : RequestInit = {
                method: variant.method,
                headers: { cookie, origin: ORIGIN, ...(variant.body ? { 'content-type': 'application/json' } : {}) },
            };
            if(variant.body) { init.body = variant.body; }

            const res = await booted.app.request(`${ ORIGIN }${ variant.path }`, init);
            const body = await res.json();

            expect(res.status, `${ variant.method } ${ variant.path }`).toBe(404);
            expect(body).toEqual({ error: 'Not Found' });
        }));
    });

    it('leaves the non-admin auth surface reachable for the same admin session', async () =>
    {
        const booted = await bootTestApp();
        const cookie = await makeAdmin(booted, 'root@example.com', 'correct-horse-battery');

        const res = await booted.app.request(`${ ORIGIN }/api/auth/get-session`, { headers: { cookie } });

        expect(res.status).toBe(200);
    });
});

//----------------------------------------------------------------------------------------------------------------------
