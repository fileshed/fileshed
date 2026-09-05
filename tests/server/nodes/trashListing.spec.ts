//----------------------------------------------------------------------------------------------------------------------
// Node Routes — GET /api/trash, DELETE /api/trash
//
// The Trash view's HTTP contract, driven end to end through the real stack: a caller lists the roots of their own
// trashed subtrees, a trashed folder lists once (its descendants ride along, never on their own), one user's trash is
// invisible to another, and restoring a node drops it out of the listing. Emptying the trash purges every one of the
// caller's own trashed roots in one call and reports how many, leaving another user's trash untouched. No session is
// a 401 on either route.
//----------------------------------------------------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';
import type { Hono } from 'hono';

import type { NodeListResponse } from '@fileshed/core';

// Support
import { ORIGIN, bootTestApp, cookieFrom, signUp } from '../auth/support.ts';
import { composeNodeApp } from './support.ts';

//----------------------------------------------------------------------------------------------------------------------

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

async function createFolder(app : Hono, cookie : string, name : string, parentID : string | null = null)
: Promise<string>
{
    const res = await request(app, 'POST', '/api/nodes', cookie, { type: 'folder', name, parentID });
    return (await res.json() as { id : string }).id;
}

async function trashIDs(app : Hono, cookie : string) : Promise<string[]>
{
    const res = await request(app, 'GET', '/api/trash', cookie);
    expect(res.status).toBe(200);

    return (await res.json() as NodeListResponse).nodes.map((node) => node.id);
}

//----------------------------------------------------------------------------------------------------------------------

describe('GET /api/trash', () =>
{
    it('lists the caller\'s trashed node as an owner-role root, omitting their live ones', async () =>
    {
        const booted = await bootTestApp();
        const app = composeNodeApp(booted);
        const cookie = await signedUp(app, 'a@example.com');

        const live = await createFolder(app, cookie, 'Keep');
        const gone = await createFolder(app, cookie, 'Trash Me');
        expect((await request(app, 'POST', `/api/nodes/${ gone }/trash`, cookie, {})).status).toBe(200);

        const res = await request(app, 'GET', '/api/trash', cookie);
        const body = await res.json() as NodeListResponse;

        expect(res.status).toBe(200);
        expect(body.nodes.map((node) => node.id)).toEqual([ gone ]);
        expect(body.nodes.map((node) => node.id)).not.toContain(live);
        expect(body.nodes[0]?.role).toBe('owner');
        expect(body.total).toBe(1);
        // The trash faces no single folder, so it carries no owner facet.
        expect(body.owners).toEqual([]);
    });

    it('lists a trashed folder once, never the descendants that ride along', async () =>
    {
        const booted = await bootTestApp();
        const app = composeNodeApp(booted);
        const cookie = await signedUp(app, 'a@example.com');

        const folder = await createFolder(app, cookie, 'Parent');
        await createFolder(app, cookie, 'Child', folder);
        expect((await request(app, 'POST', `/api/nodes/${ folder }/trash`, cookie, {})).status).toBe(200);

        expect(await trashIDs(app, cookie)).toEqual([ folder ]);
    });

    it('shows one user\'s trash to no other user', async () =>
    {
        const booted = await bootTestApp();
        const app = composeNodeApp(booted);
        const cookieA = await signedUp(app, 'a@example.com');
        const cookieB = await signedUp(app, 'b@example.com');

        const folderA = await createFolder(app, cookieA, 'A Only');
        expect((await request(app, 'POST', `/api/nodes/${ folderA }/trash`, cookieA, {})).status).toBe(200);

        expect(await trashIDs(app, cookieA)).toEqual([ folderA ]);
        expect(await trashIDs(app, cookieB)).toEqual([]);
    });

    it('drops a node from the trash listing once it is restored', async () =>
    {
        const booted = await bootTestApp();
        const app = composeNodeApp(booted);
        const cookie = await signedUp(app, 'a@example.com');

        const folder = await createFolder(app, cookie, 'Round Trip');
        expect((await request(app, 'POST', `/api/nodes/${ folder }/trash`, cookie, {})).status).toBe(200);
        expect(await trashIDs(app, cookie)).toEqual([ folder ]);

        expect((await request(app, 'POST', `/api/nodes/${ folder }/restore`, cookie, {})).status).toBe(200);
        expect(await trashIDs(app, cookie)).toEqual([]);
    });

    it('rejects an unauthenticated request with 401', async () =>
    {
        const booted = await bootTestApp();
        const app = composeNodeApp(booted);

        const res = await request(app, 'GET', '/api/trash');

        expect(res.status).toBe(401);
    });
});

//----------------------------------------------------------------------------------------------------------------------

// The trash view carries the same Type and Modified filters the drive listing does, riding the same childrenQueryCodec
// params. These prove the params travel parse -> manager -> RA over the wire and bound the listing; the precise SQL
// semantics (roots-only under a filter, the half-open window) are proven at the RA level.
describe('GET /api/trash — Type and Modified filters', () =>
{
    it('narrows the trashed roots to the selected type family', async () =>
    {
        const booted = await bootTestApp();
        const app = composeNodeApp(booted);
        const cookie = await signedUp(app, 'a@example.com');

        const folder = await createFolder(app, cookie, 'Trashed Folder');
        expect((await request(app, 'POST', `/api/nodes/${ folder }/trash`, cookie, {})).status).toBe(200);

        const asFolders = await (await request(app, 'GET', '/api/trash?types=folders', cookie)).json();
        const asImages = await (await request(app, 'GET', '/api/trash?types=images', cookie)).json();

        expect((asFolders as NodeListResponse).nodes.map((node) => node.id)).toEqual([ folder ]);
        expect((asImages as NodeListResponse).nodes).toEqual([]);
    });

    it('bounds the trashed roots by the modified window', async () =>
    {
        const booted = await bootTestApp();
        const app = composeNodeApp(booted);
        const cookie = await signedUp(app, 'a@example.com');

        const folder = await createFolder(app, cookie, 'Trashed Folder');
        expect((await request(app, 'POST', `/api/nodes/${ folder }/trash`, cookie, {})).status).toBe(200);

        const futurePath = '/api/trash?updatedAfter=2999-01-01T00:00:00.000Z';
        const pastPath = '/api/trash?updatedAfter=2000-01-01T00:00:00.000Z';
        const future = await (await request(app, 'GET', futurePath, cookie)).json() as NodeListResponse;
        const past = await (await request(app, 'GET', pastPath, cookie)).json() as NodeListResponse;

        expect(future.nodes).toEqual([]);
        expect(past.nodes.map((node) => node.id)).toEqual([ folder ]);
    });
});

//----------------------------------------------------------------------------------------------------------------------

describe('DELETE /api/trash', () =>
{
    it('purges every trashed root and reports the count, leaving the listing empty', async () =>
    {
        const booted = await bootTestApp();
        const app = composeNodeApp(booted);
        const cookie = await signedUp(app, 'a@example.com');

        const folder = await createFolder(app, cookie, 'Trash Me');
        const solo = await createFolder(app, cookie, 'Also Trash Me');
        expect((await request(app, 'POST', `/api/nodes/${ folder }/trash`, cookie, {})).status).toBe(200);
        expect((await request(app, 'POST', `/api/nodes/${ solo }/trash`, cookie, {})).status).toBe(200);

        const res = await request(app, 'DELETE', '/api/trash', cookie);

        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ purged: 2 });
        expect(await trashIDs(app, cookie)).toEqual([]);
    });

    it('empties only the caller\'s trash, leaving another user\'s trashed roots intact', async () =>
    {
        const booted = await bootTestApp();
        const app = composeNodeApp(booted);
        const cookieA = await signedUp(app, 'a@example.com');
        const cookieB = await signedUp(app, 'b@example.com');

        const folderA = await createFolder(app, cookieA, 'A Only');
        const folderB = await createFolder(app, cookieB, 'B Only');
        expect((await request(app, 'POST', `/api/nodes/${ folderA }/trash`, cookieA, {})).status).toBe(200);
        expect((await request(app, 'POST', `/api/nodes/${ folderB }/trash`, cookieB, {})).status).toBe(200);

        const res = await request(app, 'DELETE', '/api/trash', cookieA);

        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ purged: 1 });
        expect(await trashIDs(app, cookieA)).toEqual([]);
        expect(await trashIDs(app, cookieB)).toEqual([ folderB ]);
    });

    it('is a harmless no-op on an already-empty trash', async () =>
    {
        const booted = await bootTestApp();
        const app = composeNodeApp(booted);
        const cookie = await signedUp(app, 'a@example.com');

        const res = await request(app, 'DELETE', '/api/trash', cookie);

        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ purged: 0 });
    });

    it('rejects an unauthenticated request with 401', async () =>
    {
        const booted = await bootTestApp();
        const app = composeNodeApp(booted);

        const res = await request(app, 'DELETE', '/api/trash');

        expect(res.status).toBe(401);
    });
});

//----------------------------------------------------------------------------------------------------------------------
