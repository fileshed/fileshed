//----------------------------------------------------------------------------------------------------------------------
// Auth — the gated plugin surfaces
//
// The security assertion of the gated-capability pattern: better-auth's /api/auth/admin/* endpoints must be
// unreachable from outside, EVEN with a valid admin session — if any variant leaks through, the whole plugin surface
// (ban, impersonate, set-role, delete) is exposed. The api-key plugin's stock endpoints join the same gate: reachable,
// they would let any session mint unscoped keys outside our vocabulary, where the only sanctioned surface is
// /api/me/access-tokens. These specs are the tripwire.
//----------------------------------------------------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';

// App
import { targetsGatedAuthSurface, targetsSignUpSurface } from '@server/app.ts';

// Support
import { ORIGIN, bootTestApp, makeAdmin } from './support.ts';

//----------------------------------------------------------------------------------------------------------------------

describe('targetsGatedAuthSurface', () =>
{
    it('matches the admin prefix and its endpoints', () =>
    {
        expect(targetsGatedAuthSurface('/api/auth/admin')).toBe(true);
        expect(targetsGatedAuthSurface('/api/auth/admin/list-users')).toBe(true);
        expect(targetsGatedAuthSurface('/api/auth/admin/set-role')).toBe(true);
    });

    it('matches the api-key prefix and its endpoints', () =>
    {
        expect(targetsGatedAuthSurface('/api/auth/api-key')).toBe(true);
        expect(targetsGatedAuthSurface('/api/auth/api-key/create')).toBe(true);
        expect(targetsGatedAuthSurface('/api/auth/api-key/list')).toBe(true);
        expect(targetsGatedAuthSurface('/api/auth/api-key/delete')).toBe(true);
    });

    it('matches evasion variants: encoded slash, doubled slashes, trailing slash, uppercase', () =>
    {
        expect(targetsGatedAuthSurface('/api/auth/admin%2Flist-users')).toBe(true);
        expect(targetsGatedAuthSurface('/api/auth//admin/list-users')).toBe(true);
        expect(targetsGatedAuthSurface('/api/auth/admin/list-users/')).toBe(true);
        expect(targetsGatedAuthSurface('/api/auth/ADMIN/list-users')).toBe(true);
        expect(targetsGatedAuthSurface('/api/auth/api-key%2Fcreate')).toBe(true);
        expect(targetsGatedAuthSurface('/api/auth//api-key/create')).toBe(true);
        expect(targetsGatedAuthSurface('/api/auth/API-KEY/create')).toBe(true);
    });

    it('does not match the non-gated auth surface or lookalikes', () =>
    {
        expect(targetsGatedAuthSurface('/api/auth/get-session')).toBe(false);
        expect(targetsGatedAuthSurface('/api/auth/sign-in/email')).toBe(false);
        expect(targetsGatedAuthSurface('/api/auth/administrator')).toBe(false);
        expect(targetsGatedAuthSurface('/api/auth/api-keychain')).toBe(false);
        expect(targetsGatedAuthSurface('/api/health')).toBe(false);
    });
});

//----------------------------------------------------------------------------------------------------------------------

// Same adversarial normalization as the plugin gate: when an admin switches sign-ups off, an evasion-spelled path
// must not slip a registration through.
describe('targetsSignUpSurface', () =>
{
    it('matches the sign-up prefix, its endpoints, and evasion variants', () =>
    {
        expect(targetsSignUpSurface('/api/auth/sign-up')).toBe(true);
        expect(targetsSignUpSurface('/api/auth/sign-up/email')).toBe(true);
        expect(targetsSignUpSurface('/api/auth//sign-up/email')).toBe(true);
        expect(targetsSignUpSurface('/api/auth/sign-up%2Femail')).toBe(true);
        expect(targetsSignUpSurface('/api/auth/SIGN-UP/email')).toBe(true);
        expect(targetsSignUpSurface('/api/auth/sign-up/email/')).toBe(true);
    });

    it('does not match sign-in or lookalikes', () =>
    {
        expect(targetsSignUpSurface('/api/auth/sign-in/email')).toBe(false);
        expect(targetsSignUpSurface('/api/auth/sign-upgrade')).toBe(false);
        expect(targetsSignUpSurface('/api/setup')).toBe(false);
    });
});

//----------------------------------------------------------------------------------------------------------------------

describe('gated plugin HTTP surfaces', () =>
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
            { method: 'POST', path: '/api/auth/api-key/create', body: '{}' },
            { method: 'GET', path: '/api/auth/api-key/list' },
            { method: 'POST', path: '/api/auth/api-key/update', body: '{}' },
            { method: 'POST', path: '/api/auth/api-key/delete', body: '{}' },
            { method: 'GET', path: '/api/auth/api-key/get' },
            { method: 'POST', path: '/api/auth//api-key/create', body: '{}' },
            { method: 'POST', path: '/api/auth/api-key%2Fcreate', body: '{}' },
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

    it('leaves the non-gated auth surface reachable for the same admin session', async () =>
    {
        const booted = await bootTestApp();
        const cookie = await makeAdmin(booted, 'root@example.com', 'correct-horse-battery');

        const res = await booted.app.request(`${ ORIGIN }/api/auth/get-session`, { headers: { cookie } });

        expect(res.status).toBe(200);
    });
});

//----------------------------------------------------------------------------------------------------------------------
