//----------------------------------------------------------------------------------------------------------------------
// Me Route — GET /api/me
//
// The caller's own profile plus quota. A fresh account owns no files, so its charged usage is zero and, with no cap
// configured, both its raw limit and its effective one are null. The two are not the same field: limit is what the
// user row says (null = inherit), effective is what the instance actually enforces, and only the second is safe to
// render as "your cap". The usage-under-load case (owned files, including trashed) lives in the manager spec where
// files can be seeded directly.
//----------------------------------------------------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';

// Support
import { ORIGIN, bootTestApp, cookieFrom, signUp } from '../auth/support.ts';
import { composeNodeApp, userIDByEmail } from './support.ts';

//----------------------------------------------------------------------------------------------------------------------

describe('GET /api/me', () =>
{
    it('returns the caller\'s profile with an empty, unlimited quota for a fresh account', async () =>
    {
        const booted = await bootTestApp();
        const app = composeNodeApp(booted);
        const cookie = cookieFrom(await signUp(app, 'a@example.com', 'correct-horse-battery'));
        const id = await userIDByEmail(booted, 'a@example.com');

        const res = await app.request(`${ ORIGIN }/api/me`, { headers: { cookie } });
        const body = await res.json();

        expect(res.status).toBe(200);
        expect(body).toMatchObject({
            id,
            email: 'a@example.com',
            role: 'user',
            quota: { used: 0, effective: null, limit: null },
            limits: { trashRetentionDays: 30 },
        });
        expect(body.preferences).toEqual({});
    });

    // The client renders the storage gauge from effective, so an account inheriting a capped instance must see the
    // cap here -- reporting its own null would draw an unlimited bar for an account that is anything but.
    it('reports the instance default as the effective cap for an account inheriting it', async () =>
    {
        const booted = await bootTestApp();
        const app = composeNodeApp(booted, undefined, { defaultQuota: async () => 8192 });
        const cookie = cookieFrom(await signUp(app, 'a@example.com', 'correct-horse-battery'));

        const body = await (await app.request(`${ ORIGIN }/api/me`, { headers: { cookie } })).json();

        expect(body.quota).toEqual({ used: 0, effective: 8192, limit: null });
    });
});

//----------------------------------------------------------------------------------------------------------------------
