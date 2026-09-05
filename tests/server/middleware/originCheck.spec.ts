//----------------------------------------------------------------------------------------------------------------------
// Origin Check Middleware — over a real mutating route
//----------------------------------------------------------------------------------------------------------------------

import { Hono } from 'hono';
import { afterEach, describe, expect, it } from 'vitest';

// Middleware
import { createOriginCheck } from '@server/middleware/originCheck.ts';

// Test support
import { ORIGIN, bootFullApp, cookieFrom, signIn, signUp } from '../auth/support.ts';

//----------------------------------------------------------------------------------------------------------------------

const EMAIL = 'owner@example.com';
const PASSWORD = 'correct-horse-battery-staple';

const closers : (() => void)[] = [];

afterEach(() =>
{
    for(const close of closers.splice(0)) { close(); }
});

//----------------------------------------------------------------------------------------------------------------------

// A signed-in session over the full app, with the check mounted ahead of every route -- the position app.ts gives it.
async function signedIn() : Promise<{ post : (origin : string | null) => Promise<Response> }>
{
    const booted = await bootFullApp();
    closers.push(() => { void booted.handle.db.destroy(); });

    await signUp(booted.app, EMAIL, PASSWORD);
    const session = cookieFrom(await signIn(booted.app, EMAIL, PASSWORD));

    const app = new Hono();
    app.use('*', createOriginCheck({ allowedOrigins: [ ORIGIN ] }));
    app.route('/', booted.app);

    return {
        post: async (origin : string | null) => app.request(`${ ORIGIN }/api/nodes`, {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                'cookie': session,
                ...origin === null ? {} : { origin },
            },
            body: JSON.stringify({ type: 'folder', name: 'Notes', parentID: null }),
        }),
    };
}

//----------------------------------------------------------------------------------------------------------------------

describe('createOriginCheck', () =>
{
    it('refuses a cookie-carrying write posted from another site', async () =>
    {
        const { post } = await signedIn();

        const response = await post('https://evil.example');

        expect(response.status).toBe(403);
    });

    it('lets the instance\'s own client write', async () =>
    {
        const { post } = await signedIn();

        const response = await post(ORIGIN);

        expect(response.status).toBe(201);
    });

    it('lets a client that sends no origin write', async () =>
    {
        const { post } = await signedIn();

        const response = await post(null);

        expect(response.status).toBe(201);
    });
});

//----------------------------------------------------------------------------------------------------------------------
