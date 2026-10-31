//----------------------------------------------------------------------------------------------------------------------
// Auth — sign-up, sign-in, and the session helper
//----------------------------------------------------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';

// Models
import { UnauthorizedError } from '@fileshed/core';

// Managers
import { SessionManager } from '@server/managers/session.ts';

// Resource Access
import { AuthRA } from '@server/resource-access/auth/index.ts';

// Support
import { type BootedApp, ORIGIN, bootTestApp, cookieFrom, signIn, signUp } from './support.ts';

//----------------------------------------------------------------------------------------------------------------------

// A minimal route that hands back whatever the session manager resolves, so the seam is exercised through real request
// headers rather than asserted in isolation.
function whoami(booted : BootedApp) : Hono
{
    const sessions = new SessionManager(new AuthRA(booted.auth, booted.handle));
    const app = new Hono();
    app.get('/whoami', async (ctx) => ctx.json({ user: await sessions.requireUser(ctx.req.raw.headers) }));
    app.onError((error, ctx) => ctx.json({ error: error.message }, error instanceof UnauthorizedError ? 401 : 500));
    return app;
}

//----------------------------------------------------------------------------------------------------------------------

describe('email/password auth', () =>
{
    it('signs a new user up and returns a session cookie', async () =>
    {
        const booted = await bootTestApp();

        const res = await signUp(booted.app, 'ada@example.com', 'correct-horse-battery');

        expect(res.status).toBe(200);
        expect(cookieFrom(res)).not.toBe('');
    });

    it('signs an existing user in and returns a session cookie', async () =>
    {
        const booted = await bootTestApp();
        await signUp(booted.app, 'ada@example.com', 'correct-horse-battery');

        const res = await signIn(booted.app, 'ada@example.com', 'correct-horse-battery');

        expect(res.status).toBe(200);
        expect(cookieFrom(res)).not.toBe('');
    });

    it('resolves the signed-in user from the session cookie', async () =>
    {
        const booted = await bootTestApp();
        const cookie = cookieFrom(await signUp(booted.app, 'ada@example.com', 'correct-horse-battery'));

        const res = await whoami(booted).request(`${ ORIGIN }/whoami`, { headers: { cookie } });
        const body = await res.json();

        expect(body.user).not.toBeNull();
        expect(body.user.email).toBe('ada@example.com');
    });

    it('refuses a request without a session cookie as unauthenticated', async () =>
    {
        const booted = await bootTestApp();

        const res = await whoami(booted).request(`${ ORIGIN }/whoami`);

        expect(res.status).toBe(401);
    });

    it('creates the user row with the default role and no quota', async () =>
    {
        const booted = await bootTestApp();
        await signUp(booted.app, 'ada@example.com', 'correct-horse-battery');

        const row = await booted.handle.db
            .selectFrom('user')
            .select([ 'role', 'quota_limit' ])
            .where('email', '=', 'ada@example.com')
            .executeTakeFirstOrThrow();

        expect(row.role).toBe('user');
        expect(row.quota_limit).toBeNull();
    });
});

//----------------------------------------------------------------------------------------------------------------------
