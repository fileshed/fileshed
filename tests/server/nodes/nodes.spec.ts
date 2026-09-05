//----------------------------------------------------------------------------------------------------------------------
// Node Routes — /api/nodes
//
// The HTTP contract of the tree surface, driven end to end through the real stack:
// create/read/list/rename/move/trash/restore/delete, the effective role that rides every node payload, link target
// resolution (live and dead), and the regulation rejections that reach the wire as 403/422.
//----------------------------------------------------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';
import type { Hono } from 'hono';

// Models
import type { NodeResponse } from '@fileshed/core';

// Support
import { ORIGIN, bootTestApp, cookieFrom, signUp } from '../auth/support.ts';
import { composeNodeApp, seedLinkRow, seedShareRow, userIDByEmail } from './support.ts';

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

function postNode(app : Hono, cookie : string, body : unknown) : Promise<Response>
{
    return request(app, 'POST', '/api/nodes', cookie, body);
}

async function createFolder(
    app : Hono,
    cookie : string,
    name : string,
    parentID : string | null = null
) : Promise<NodeResponse>
{
    const res = await postNode(app, cookie, { type: 'folder', name, parentID });

    return await res.json() as NodeResponse;
}

async function createLink(
    app : Hono,
    cookie : string,
    targetNodeID : string,
    parentID : string | null = null,
    name ?: string
) : Promise<Response>
{
    return postNode(app, cookie, { type: 'link', targetNodeID, parentID, name });
}

//----------------------------------------------------------------------------------------------------------------------

describe('POST /api/nodes (folders)', () =>
{
    it('creates a folder at the root, owned by the caller, with role owner', async () =>
    {
        const booted = await bootTestApp();
        const app = composeNodeApp(booted);
        const cookie = await signedUp(app, 'a@example.com');
        const ownerID = await userIDByEmail(booted, 'a@example.com');

        const res = await request(app, 'POST', '/api/nodes', cookie, { type: 'folder', name: 'Docs', parentID: null });
        const body = await res.json() as Json;

        expect(res.status).toBe(201);
        expect(body).toMatchObject({ type: 'folder', name: 'Docs', parentID: null, ownerID, role: 'owner' });
    });

    it('creates a folder nested under a folder the caller owns', async () =>
    {
        const booted = await bootTestApp();
        const app = composeNodeApp(booted);
        const cookie = await signedUp(app, 'a@example.com');

        const parent = await createFolder(app, cookie, 'Parent');
        const res = await postNode(app, cookie, { type: 'folder', name: 'Child', parentID: parent.id });
        const body = await res.json() as Json;

        expect(res.status).toBe(201);
        expect(body.parentID).toBe(parent.id);
    });

    it('rejects creating a folder inside a folder owned by another user', async () =>
    {
        const booted = await bootTestApp();
        const app = composeNodeApp(booted);
        const cookieB = await signedUp(app, 'b@example.com');
        const cookieA = await signedUp(app, 'a@example.com');

        const foreign = await createFolder(app, cookieB, 'B Folder');
        const res = await postNode(app, cookieA, { type: 'folder', name: 'Sneaky', parentID: foreign.id });
        const body = await res.json() as { violations : { code : string }[] };

        expect(res.status).toBe(403);
        expect(body.violations.map((violation) => violation.code)).toContain('parent.crossOwner');
    });
});

//----------------------------------------------------------------------------------------------------------------------

describe('POST /api/nodes (links)', () =>
{
    it('defaults an unnamed link to the target name and resolves the target for display', async () =>
    {
        const booted = await bootTestApp();
        const app = composeNodeApp(booted);
        const cookie = await signedUp(app, 'a@example.com');

        const target = await createFolder(app, cookie, 'Photos');
        const res = await createLink(app, cookie, target.id);
        const body = await res.json() as Json;

        expect(res.status).toBe(201);
        expect(body).toMatchObject({ type: 'link', name: 'Photos', targetNodeID: target.id, role: 'owner' });
        expect(body.target).toMatchObject({ id: target.id, type: 'folder', name: 'Photos' });
    });

    it('rejects a link that targets another link', async () =>
    {
        const booted = await bootTestApp();
        const app = composeNodeApp(booted);
        const cookie = await signedUp(app, 'a@example.com');

        const folder = await createFolder(app, cookie, 'Folder');
        const link = await (await createLink(app, cookie, folder.id)).json() as Json;

        const res = await createLink(app, cookie, link.id as string);
        const body = await res.json() as { violations : { code : string }[] };

        expect(res.status).toBe(422);
        expect(body.violations.map((violation) => violation.code)).toContain('link.targetIsLink');
    });
});

//----------------------------------------------------------------------------------------------------------------------

describe('GET /api/nodes/:id', () =>
{
    it('returns a node the caller owns with role owner', async () =>
    {
        const booted = await bootTestApp();
        const app = composeNodeApp(booted);
        const cookie = await signedUp(app, 'a@example.com');

        const folder = await createFolder(app, cookie, 'Docs');
        const res = await request(app, 'GET', `/api/nodes/${ folder.id }`, cookie);
        const body = await res.json() as Json;

        expect(res.status).toBe(200);
        expect(body).toMatchObject({ id: folder.id, role: 'owner' });
    });

    it('returns 404 for a node owned by another user, never confirming it exists', async () =>
    {
        const booted = await bootTestApp();
        const app = composeNodeApp(booted);
        const cookieB = await signedUp(app, 'b@example.com');
        const cookieA = await signedUp(app, 'a@example.com');

        const foreign = await createFolder(app, cookieB, 'B Folder');
        const res = await request(app, 'GET', `/api/nodes/${ foreign.id }`, cookieA);

        expect(res.status).toBe(404);
    });
});

//----------------------------------------------------------------------------------------------------------------------

describe('GET /api/nodes children listing', () =>
{
    it('lists the caller\'s root nodes with role and a resolved live link target', async () =>
    {
        const booted = await bootTestApp();
        const app = composeNodeApp(booted);
        const cookie = await signedUp(app, 'a@example.com');

        const folder = await createFolder(app, cookie, 'Photos');
        await createLink(app, cookie, folder.id);

        const res = await request(app, 'GET', '/api/nodes/children', cookie);
        const body = await res.json() as { nodes : Json[]; total : number };

        expect(res.status).toBe(200);
        expect(body.total).toBe(2);
        expect(body.nodes.every((node) => node.role === 'owner')).toBe(true);

        const link = body.nodes.find((node) => node.type === 'link');
        expect(link?.target).toMatchObject({ id: folder.id, type: 'folder', name: 'Photos' });
    });

    it('lists a dead link with a null target', async () =>
    {
        const booted = await bootTestApp();
        const app = composeNodeApp(booted);
        const cookieB = await signedUp(app, 'b@example.com');
        const cookieA = await signedUp(app, 'a@example.com');
        const ownerA = await userIDByEmail(booted, 'a@example.com');

        // A link A owns pointing at B's folder, planted directly -- the placement a since-revoked share leaves behind.
        const foreign = await createFolder(app, cookieB, 'B Folder');
        await seedLinkRow(booted, { id: 'deadlink', ownerID: ownerA, targetNodeID: foreign.id, name: 'Was Shared' });

        const res = await request(app, 'GET', '/api/nodes/children', cookieA);
        const body = await res.json() as { nodes : Json[] };

        const link = body.nodes.find((node) => node.id === 'deadlink');
        expect(link).toMatchObject({ type: 'link', name: 'Was Shared', target: null });
    });

    it('lists the children of a folder the caller owns', async () =>
    {
        const booted = await bootTestApp();
        const app = composeNodeApp(booted);
        const cookie = await signedUp(app, 'a@example.com');

        const parent = await createFolder(app, cookie, 'Parent');
        const child = await createFolder(app, cookie, 'Child', parent.id);

        const res = await request(app, 'GET', `/api/nodes/${ parent.id }/children`, cookie);
        const body = await res.json() as { nodes : Json[]; total : number };

        expect(body.total).toBe(1);
        expect(body.nodes[0]?.id).toBe(child.id);
    });

    it('excludes trashed nodes from the listing', async () =>
    {
        const booted = await bootTestApp();
        const app = composeNodeApp(booted);
        const cookie = await signedUp(app, 'a@example.com');

        const folder = await createFolder(app, cookie, 'Temp');
        await request(app, 'POST', `/api/nodes/${ folder.id }/trash`, cookie);

        const res = await request(app, 'GET', '/api/nodes/children', cookie);
        const body = await res.json() as { nodes : Json[]; total : number };

        expect(body.total).toBe(0);
        expect(body.nodes).toHaveLength(0);
    });

    it('filters the listing by type family from the query string', async () =>
    {
        const booted = await bootTestApp();
        const app = composeNodeApp(booted);
        const cookie = await signedUp(app, 'a@example.com');

        const folder = await createFolder(app, cookie, 'Photos');
        const link = await (await createLink(app, cookie, folder.id)).json() as Json;

        const folders = await (await request(app, 'GET', '/api/nodes/children?types=folders', cookie))
            .json() as { nodes : Json[]; total : number };
        const links = await (await request(app, 'GET', '/api/nodes/children?types=links', cookie))
            .json() as { nodes : Json[]; total : number };

        expect(folders.nodes.map((node) => node.id)).toEqual([ folder.id ]);
        expect(folders.total).toBe(1);
        expect(links.nodes.map((node) => node.id)).toEqual([ link.id ]);
    });

    it('narrows the listing to a modified window from the query string', async () =>
    {
        const booted = await bootTestApp();
        const app = composeNodeApp(booted);
        const cookie = await signedUp(app, 'a@example.com');

        await createFolder(app, cookie, 'Recent');

        const future = '2999-01-01T00:00:00.000Z';
        const past = '2000-01-01T00:00:00.000Z';
        const afterFuture = await (await request(app, 'GET', `/api/nodes/children?updatedAfter=${ future }`, cookie))
            .json() as { total : number };
        const afterPast = await (await request(app, 'GET', `/api/nodes/children?updatedAfter=${ past }`, cookie))
            .json() as { total : number };

        expect(afterFuture.total).toBe(0);
        expect(afterPast.total).toBe(1);
    });

    it('carries the owner facet on the listing envelope', async () =>
    {
        const booted = await bootTestApp();
        const app = composeNodeApp(booted);
        const cookie = await signedUp(app, 'a@example.com');
        const ownerID = await userIDByEmail(booted, 'a@example.com');

        await createFolder(app, cookie, 'Docs');

        const res = await request(app, 'GET', '/api/nodes/children', cookie);
        const body = await res.json() as { owners : { id : string; email : string }[] };

        expect(body.owners).toHaveLength(1);
        expect(body.owners[0]).toMatchObject({ id: ownerID, email: 'a@example.com' });
    });
});

//----------------------------------------------------------------------------------------------------------------------

describe('GET /api/nodes/:id/children through a folder link', () =>
{
    // Navigating INTO a folder link lists its target's children over the wire: the URL carries the link id, and the
    // listing resolves the target under the caller's own access, so each child shows the role a direct read of the
    // target would give -- the link conducts nothing.
    it('lists a folder link\'s target children, each with the caller\'s effective role', async () =>
    {
        const booted = await bootTestApp();
        const app = composeNodeApp(booted);
        const cookieCarol = await signedUp(app, 'carol@example.com');
        const cookieAlice = await signedUp(app, 'alice@example.com');
        const carolID = await userIDByEmail(booted, 'carol@example.com');
        const aliceID = await userIDByEmail(booted, 'alice@example.com');

        const docs = await createFolder(app, cookieCarol, 'Documents');
        const docsID = docs.id as string;
        const reports = await createFolder(app, cookieCarol, 'Reports', docsID);
        await seedShareRow(booted, { nodeID: docsID, granteeID: aliceID, role: 'viewer', createdBy: carolID });
        await seedLinkRow(booted, {
            id: 'alicelink',
            ownerID: aliceID,
            targetNodeID: docsID,
            name: 'Case Test\'s Docs',
        });

        const res = await request(app, 'GET', '/api/nodes/alicelink/children', cookieAlice);
        const body = await res.json() as { nodes : Json[]; total : number };

        expect(res.status).toBe(200);
        expect(body.total).toBe(1);
        expect(body.nodes[0]).toMatchObject({ id: reports.id, name: 'Reports', role: 'viewer' });
    });

    it('answers 404 when the link\'s target does not resolve for the caller', async () =>
    {
        const booted = await bootTestApp();
        const app = composeNodeApp(booted);
        const cookieCarol = await signedUp(app, 'carol@example.com');
        const cookieAlice = await signedUp(app, 'alice@example.com');
        const aliceID = await userIDByEmail(booted, 'alice@example.com');

        const priv = await createFolder(app, cookieCarol, 'Private');
        await seedLinkRow(booted, { id: 'deadlink', ownerID: aliceID, targetNodeID: priv.id as string });

        const res = await request(app, 'GET', '/api/nodes/deadlink/children', cookieAlice);

        expect(res.status).toBe(404);
    });
});

//----------------------------------------------------------------------------------------------------------------------

describe('PATCH /api/nodes/:id', () =>
{
    it('renames a node the caller owns', async () =>
    {
        const booted = await bootTestApp();
        const app = composeNodeApp(booted);
        const cookie = await signedUp(app, 'a@example.com');

        const folder = await createFolder(app, cookie, 'Old Name');
        const res = await request(app, 'PATCH', `/api/nodes/${ folder.id }`, cookie, { name: 'New Name' });
        const body = await res.json() as Json;

        expect(res.status).toBe(200);
        expect(body.name).toBe('New Name');
    });

    it('moves a node into another folder the caller owns', async () =>
    {
        const booted = await bootTestApp();
        const app = composeNodeApp(booted);
        const cookie = await signedUp(app, 'a@example.com');

        const from = await createFolder(app, cookie, 'From');
        const to = await createFolder(app, cookie, 'To');
        const child = await createFolder(app, cookie, 'Child', from.id);

        const res = await request(app, 'PATCH', `/api/nodes/${ child.id }`, cookie, { parentID: to.id });
        const body = await res.json() as Json;

        expect(res.status).toBe(200);
        expect(body.parentID).toBe(to.id);
    });

    it('rejects moving a folder into its own descendant', async () =>
    {
        const booted = await bootTestApp();
        const app = composeNodeApp(booted);
        const cookie = await signedUp(app, 'a@example.com');

        const parent = await createFolder(app, cookie, 'Parent');
        const child = await createFolder(app, cookie, 'Child', parent.id);

        const res = await request(app, 'PATCH', `/api/nodes/${ parent.id }`, cookie, { parentID: child.id });
        const body = await res.json() as { violations : { code : string }[] };

        expect(res.status).toBe(422);
        expect(body.violations.map((violation) => violation.code)).toContain('move.intoDescendant');
    });

    it('rejects a patch on a node owned by another user with 403', async () =>
    {
        const booted = await bootTestApp();
        const app = composeNodeApp(booted);
        const cookieB = await signedUp(app, 'b@example.com');
        const cookieA = await signedUp(app, 'a@example.com');

        const foreign = await createFolder(app, cookieB, 'B Folder');
        const res = await request(app, 'PATCH', `/api/nodes/${ foreign.id }`, cookieA, { name: 'Mine Now' });

        expect(res.status).toBe(403);
    });
});

//----------------------------------------------------------------------------------------------------------------------

describe('POST /api/nodes/:id/trash', () =>
{
    it('rejects trashing a link', async () =>
    {
        const booted = await bootTestApp();
        const app = composeNodeApp(booted);
        const cookie = await signedUp(app, 'a@example.com');

        const folder = await createFolder(app, cookie, 'Folder');
        const link = await (await createLink(app, cookie, folder.id)).json() as Json;

        const res = await request(app, 'POST', `/api/nodes/${ link.id }/trash`, cookie);
        const body = await res.json() as { violations : { code : string }[] };

        expect(res.status).toBe(422);
        expect(body.violations.map((violation) => violation.code)).toContain('trash.linkNotTrashable');
    });

    it('rejects trashing a node owned by another user with 403', async () =>
    {
        const booted = await bootTestApp();
        const app = composeNodeApp(booted);
        const cookieB = await signedUp(app, 'b@example.com');
        const cookieA = await signedUp(app, 'a@example.com');

        const foreign = await createFolder(app, cookieB, 'B Folder');
        const res = await request(app, 'POST', `/api/nodes/${ foreign.id }/trash`, cookieA);
        const body = await res.json() as { violations : { code : string }[] };

        expect(res.status).toBe(403);
        expect(body.violations.map((violation) => violation.code)).toContain('trash.notOwner');
    });
});

//----------------------------------------------------------------------------------------------------------------------

describe('POST /api/nodes/:id/restore', () =>
{
    it('restores a trashed node to its original parent when the parent is still live', async () =>
    {
        const booted = await bootTestApp();
        const app = composeNodeApp(booted);
        const cookie = await signedUp(app, 'a@example.com');

        const parent = await createFolder(app, cookie, 'Parent');
        const child = await createFolder(app, cookie, 'Child', parent.id);

        await request(app, 'POST', `/api/nodes/${ child.id }/trash`, cookie);
        const res = await request(app, 'POST', `/api/nodes/${ child.id }/restore`, cookie);
        const body = await res.json() as Json;

        expect(res.status).toBe(200);
        expect(body.parentID).toBe(parent.id);
    });

    it('restores to the root when the original parent is still trashed', async () =>
    {
        const booted = await bootTestApp();
        const app = composeNodeApp(booted);
        const cookie = await signedUp(app, 'a@example.com');

        const parent = await createFolder(app, cookie, 'Parent');
        const child = await createFolder(app, cookie, 'Child', parent.id);

        await request(app, 'POST', `/api/nodes/${ child.id }/trash`, cookie);
        await request(app, 'POST', `/api/nodes/${ parent.id }/trash`, cookie);

        const res = await request(app, 'POST', `/api/nodes/${ child.id }/restore`, cookie);
        const body = await res.json() as Json;

        expect(res.status).toBe(200);
        expect(body.parentID).toBe(null);
    });
});

//----------------------------------------------------------------------------------------------------------------------

describe('DELETE /api/nodes/:id', () =>
{
    it('removes a link from the caller\'s drive while leaving its target', async () =>
    {
        const booted = await bootTestApp();
        const app = composeNodeApp(booted);
        const cookie = await signedUp(app, 'a@example.com');

        const target = await createFolder(app, cookie, 'Target');
        const link = await (await createLink(app, cookie, target.id)).json() as Json;

        const del = await request(app, 'DELETE', `/api/nodes/${ link.id }`, cookie);
        expect(del.status).toBe(204);

        expect((await request(app, 'GET', `/api/nodes/${ link.id }`, cookie)).status).toBe(404);
        expect((await request(app, 'GET', `/api/nodes/${ target.id }`, cookie)).status).toBe(200);
    });

    it('permanently deletes a folder the caller owns', async () =>
    {
        const booted = await bootTestApp();
        const app = composeNodeApp(booted);
        const cookie = await signedUp(app, 'a@example.com');

        const folder = await createFolder(app, cookie, 'Doomed');
        const del = await request(app, 'DELETE', `/api/nodes/${ folder.id }`, cookie);

        expect(del.status).toBe(204);
        expect((await request(app, 'GET', `/api/nodes/${ folder.id }`, cookie)).status).toBe(404);
    });
});

//----------------------------------------------------------------------------------------------------------------------

describe('node route authentication', () =>
{
    it('rejects every node and me route without a session with 401', async () =>
    {
        const booted = await bootTestApp();
        const app = composeNodeApp(booted);

        const cases : [ string, string, unknown? ][]
            = [
                [ 'GET', '/api/nodes/children' ],
                [ 'GET', '/api/nodes/anything' ],
                [ 'GET', '/api/nodes/anything/children' ],
                [ 'POST', '/api/nodes', { type: 'folder', name: 'x', parentID: null } ],
                [ 'PATCH', '/api/nodes/anything', { name: 'y' } ],
                [ 'POST', '/api/nodes/anything/trash' ],
                [ 'POST', '/api/nodes/anything/restore' ],
                [ 'DELETE', '/api/nodes/anything' ],
                [ 'GET', '/api/me' ],
            ];

        await Promise.all(cases.map(async ([ method, path, body ]) =>
        {
            const res = await request(app, method, path, undefined, body);
            expect(res.status, `${ method } ${ path }`).toBe(401);
        }));
    });
});

//----------------------------------------------------------------------------------------------------------------------
