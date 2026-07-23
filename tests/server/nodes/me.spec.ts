//----------------------------------------------------------------------------------------------------------------------
// Me Route — GET /api/me
//
// The caller's own profile plus quota. A fresh account owns no files, so its charged usage is zero and, with no cap
// configured, its limit is null (unlimited). The usage-under-load case (owned files, including trashed) lives in the
// manager spec where files can be seeded directly.
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
            quota: { used: 0, limit: null },
            limits: { trashRetentionDays: 30 },
        });
        expect(body.preferences).toEqual({});
    });
});

//----------------------------------------------------------------------------------------------------------------------
