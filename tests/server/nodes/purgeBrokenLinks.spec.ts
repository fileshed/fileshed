//----------------------------------------------------------------------------------------------------------------------
// Node Routes — POST /api/nodes/:id/purge-broken-links
//
// The HTTP contract of broken-link cleanup, driven end to end through the real stack: the caller's dead links in a
// folder are removed and the live ones survive, and a folder the caller cannot resolve reads as absent (404).
//----------------------------------------------------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';
import type { Hono } from 'hono';

// Support
import { ORIGIN, bootTestApp, cookieFrom, signUp } from '../auth/support.ts';
import { composeNodeApp, seedLinkRow, userIDByEmail } from './support.ts';

//----------------------------------------------------------------------------------------------------------------------

type Json = Record<string, unknown>;

async function request(
    app : Hono,
    method : string,
    path : string,
    cookie ?: string,
    body ?: unknown
) : Promise<Response>
{
    const headers : Record<string, string> = {};
    if(cookie) { headers['cookie'] = cookie; }
    if(body !== undefined) { headers['content-type'] = 'application/json'; }

    return app.request(`${ ORIGIN }${ path }`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
    });
}

async function signedUp(app : Hono, email : string) : Promise<string>
{
    return cookieFrom(await signUp(app, email, 'correct-horse-battery'));
}

async function createFolder(app : Hono, cookie : string, name : string, parentID : string | null = null) : Promise<Json>
{
    return await (await request(app, 'POST', '/api/nodes', cookie, { type: 'folder', name, parentID })).json() as Json;
}

async function createLink(app : Hono, cookie : string, targetNodeID : string, parentID : string) : Promise<Json>
{
    const res = await request(app, 'POST', '/api/nodes', cookie, { type: 'link', targetNodeID, parentID });
    return await res.json() as Json;
}

//----------------------------------------------------------------------------------------------------------------------

describe('POST /api/nodes/:id/purge-broken-links', () =>
{
    it('removes the caller\'s dead links from the folder and leaves the live ones', async () =>
    {
        const booted = await bootTestApp();
        const app = composeNodeApp(booted);
        const cookieB = await signedUp(app, 'b@example.com');
        const cookieA = await signedUp(app, 'a@example.com');
        const ownerA = await userIDByEmail(booted, 'a@example.com');

        const foreign = await createFolder(app, cookieB, 'B Folder');
        const dir = await createFolder(app, cookieA, 'Dir');
        const visible = await createFolder(app, cookieA, 'Visible');
        const liveLink = await createLink(app, cookieA, visible.id as string, dir.id as string);
        // A link A owns pointing at B's folder, planted directly -- the placement a since-revoked share leaves behind.
        await seedLinkRow(booted, {
            id: 'deadlink',
            ownerID: ownerA,
            targetNodeID: foreign.id as string,
            parentID: dir.id as string,
            name: 'Was Shared',
        });

        const res = await request(app, 'POST', `/api/nodes/${ dir.id }/purge-broken-links`, cookieA);
        const body = await res.json() as Json;

        expect(res.status).toBe(200);
        expect(body).toEqual({ purged: 1 });

        const childrenRes = await request(app, 'GET', `/api/nodes/${ dir.id }/children`, cookieA);
        const children = await childrenRes.json() as { nodes : Json[] };
        const ids = children.nodes.map((node) => node.id);
        expect(ids).toContain(liveLink.id);
        expect(ids).not.toContain('deadlink');
    });

    it('returns 404 for a folder owned by another user, never confirming it exists', async () =>
    {
        const booted = await bootTestApp();
        const app = composeNodeApp(booted);
        const cookieB = await signedUp(app, 'b@example.com');
        const cookieA = await signedUp(app, 'a@example.com');

        const foreign = await createFolder(app, cookieB, 'B Folder');
        const res = await request(app, 'POST', `/api/nodes/${ foreign.id }/purge-broken-links`, cookieA);

        expect(res.status).toBe(404);
    });

    it('rejects the purge without a session with 401', async () =>
    {
        const booted = await bootTestApp();
        const app = composeNodeApp(booted);

        const res = await request(app, 'POST', '/api/nodes/anything/purge-broken-links');

        expect(res.status).toBe(401);
    });
});

//----------------------------------------------------------------------------------------------------------------------
