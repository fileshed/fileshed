//----------------------------------------------------------------------------------------------------------------------
// Search Routes — GET /api/search
//
// The HTTP contract of name search, driven end to end through the real stack: a case-insensitive name match scoped to
// the caller's accessible nodes (a stranger's files never appear), each hit carrying the caller's effective role, and
// a blank query rejected as a 400.
//----------------------------------------------------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';
import type { Hono } from 'hono';

// Support
import { ORIGIN, bootTestApp, cookieFrom, signUp } from '../auth/support.ts';
import { composeNodeApp } from './support.ts';

//----------------------------------------------------------------------------------------------------------------------

type Json = Record<string, unknown>;

function request(app : Hono, method : string, path : string, cookie ?: string) : Promise<Response>
{
    const headers : Record<string, string> = {};
    if(cookie) { headers['cookie'] = cookie; }

    return app.request(`${ ORIGIN }${ path }`, { method, headers });
}

async function signedUp(app : Hono, email : string) : Promise<string>
{
    return cookieFrom(await signUp(app, email, 'correct-horse-battery'));
}

async function createFolder(app : Hono, cookie : string, name : string) : Promise<void>
{
    await app.request(`${ ORIGIN }/api/nodes`, {
        method: 'POST',
        headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify({ type: 'folder', name, parentID: null }),
    });
}

//----------------------------------------------------------------------------------------------------------------------

describe('GET /api/search', () =>
{
    it('returns the caller\'s name matches with role, excluding a stranger\'s files', async () =>
    {
        const booted = await bootTestApp();
        const app = composeNodeApp(booted);
        const cookieB = await signedUp(app, 'b@example.com');
        const cookieA = await signedUp(app, 'a@example.com');

        await createFolder(app, cookieA, 'Alpha Report');
        await createFolder(app, cookieA, 'Beta Notes');
        await createFolder(app, cookieB, 'Gamma Report');

        const res = await request(app, 'GET', '/api/search?q=report', cookieA);
        const body = await res.json() as { nodes : Json[]; total : number };

        expect(res.status).toBe(200);
        expect(body.total).toBe(1);
        expect(body.nodes).toHaveLength(1);
        expect(body.nodes[0]).toMatchObject({ name: 'Alpha Report', role: 'owner' });
    });

    it('matches case-insensitively', async () =>
    {
        const booted = await bootTestApp();
        const app = composeNodeApp(booted);
        const cookie = await signedUp(app, 'a@example.com');

        await createFolder(app, cookie, 'Alpha Report');

        const res = await request(app, 'GET', '/api/search?q=REPORT', cookie);
        const body = await res.json() as { nodes : Json[]; total : number };

        expect(res.status).toBe(200);
        expect(body.total).toBe(1);
        expect(body.nodes[0]).toMatchObject({ name: 'Alpha Report' });
    });

    it('rejects a blank query with 400', async () =>
    {
        const booted = await bootTestApp();
        const app = composeNodeApp(booted);
        const cookie = await signedUp(app, 'a@example.com');

        expect((await request(app, 'GET', '/api/search?q=', cookie)).status).toBe(400);
        expect((await request(app, 'GET', '/api/search', cookie)).status).toBe(400);
    });

    it('rejects search without a session with 401', async () =>
    {
        const booted = await bootTestApp();
        const app = composeNodeApp(booted);

        const res = await request(app, 'GET', '/api/search?q=report');

        expect(res.status).toBe(401);
    });
});

//----------------------------------------------------------------------------------------------------------------------
