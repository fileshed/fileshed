//----------------------------------------------------------------------------------------------------------------------
// Share requests
//
// A user who can see a stub but cannot resolve it asks the target's OWNER for access; the owner grants (minting an
// ordinary share) or declines. Expectations: a requester must lack access, no duplicate pending request per
// (node, requester), only the target's owner may resolve, and granting mints a share that gives the requester real
// access. Driven end to end; not the implementation.
//----------------------------------------------------------------------------------------------------------------------

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ACCESS_REQUEST_MESSAGE_MAX_CHARS } from '@fileshed/core';

// Support
import {
    type BootedShareApp,
    type TestUser,
    bootShareApp,
    createFolder,
    grantShare,
    makeUser,
    request,
    setAvatarSha256,
} from './support.ts';

//----------------------------------------------------------------------------------------------------------------------

type Json = Record<string, unknown>;

let booted : BootedShareApp;
let owner : TestUser;
let requester : TestUser;
let folder : string;

beforeEach(async () =>
{
    booted = await bootShareApp();
    owner = await makeUser(booted, 'owner@example.com');
    requester = await makeUser(booted, 'requester@example.com');

    folder = await createFolder(booted.app, owner.cookie, 'Private');
});

afterEach(async () =>
{
    await booted.cleanup();
});

function requestAccess(
    cookie : string,
    nodeID : string,
    role : 'viewer' | 'editor',
    message ?: string
) : Promise<Response>
{
    const body : Json = { requestedRole: role };
    if(message !== undefined) { body['message'] = message; }

    return request(booted.app, 'POST', `/api/nodes/${ nodeID }/access-requests`, cookie, body);
}

//----------------------------------------------------------------------------------------------------------------------
// Asking for access
//----------------------------------------------------------------------------------------------------------------------

describe('POST /api/nodes/:id/access-requests', () =>
{
    it('records a pending request from a user who lacks access, with no message', async () =>
    {
        const res = await requestAccess(requester.cookie, folder, 'viewer');
        const body = await res.json() as Json;

        expect(res.status).toBe(201);
        expect(body).toMatchObject({
            nodeID: folder,
            requesterID: requester.id,
            requestedRole: 'viewer',
            message: null,
            status: 'pending',
            resolvedAt: null,
        });
    });

    it('carries a trimmed message through in the created request', async () =>
    {
        const res = await requestAccess(requester.cookie, folder, 'viewer', '  Could I get viewer access?  ');
        const body = await res.json() as Json;

        expect(res.status).toBe(201);
        expect(body['message']).toBe('Could I get viewer access?');
    });

    it('collapses a whitespace-only message to no message', async () =>
    {
        const res = await requestAccess(requester.cookie, folder, 'viewer', '   ');
        const body = await res.json() as Json;

        expect(res.status).toBe(201);
        expect(body['message']).toBeNull();
    });

    it('rejects a message over the character cap with 400', async () =>
    {
        const overCap = 'x'.repeat(ACCESS_REQUEST_MESSAGE_MAX_CHARS + 1);

        const res = await requestAccess(requester.cookie, folder, 'viewer', overCap);

        expect(res.status).toBe(400);
    });

    it('refuses a request from someone who already has access', async () =>
    {
        await grantShare(booted.app, owner.cookie, folder, requester.id, 'viewer');

        const res = await requestAccess(requester.cookie, folder, 'editor');

        expect(res.status).toBe(400);
    });

    it('refuses the owner requesting access to their own node (they already have it)', async () =>
    {
        const res = await requestAccess(owner.cookie, folder, 'viewer');

        expect(res.status).toBe(400);
    });

    it('refuses a second pending request for the same node from the same requester', async () =>
    {
        await requestAccess(requester.cookie, folder, 'viewer');

        const res = await requestAccess(requester.cookie, folder, 'editor');

        expect(res.status).toBe(400);
    });
});

//----------------------------------------------------------------------------------------------------------------------
// Listing
//----------------------------------------------------------------------------------------------------------------------

describe('GET /api/access-requests', () =>
{
    it('shows a request as incoming to the owner and outgoing to the requester', async () =>
    {
        await requestAccess(requester.cookie, folder, 'viewer');

        const ownerRes = await request(booted.app, 'GET', '/api/access-requests', owner.cookie);
        const ownerView = await ownerRes.json() as { incoming : Json[]; outgoing : Json[] };
        const requesterRes = await request(booted.app, 'GET', '/api/access-requests', requester.cookie);
        const requesterView = await requesterRes.json() as { incoming : Json[]; outgoing : Json[] };

        expect(ownerView.incoming).toHaveLength(1);
        expect(ownerView.outgoing).toHaveLength(0);
        expect(requesterView.outgoing).toHaveLength(1);
        expect(requesterView.incoming).toHaveLength(0);
    });

    it('pairs an incoming request with the requester\'s display summary', async () =>
    {
        const created = await (await requestAccess(requester.cookie, folder, 'viewer')).json() as Json;

        const res = await request(booted.app, 'GET', '/api/access-requests', owner.cookie);
        const body = await res.json() as { incoming : { request : Json; requester : Json }[] };
        const entry = body.incoming.find((candidate) => candidate.request.id === created.id);

        expect(entry).toBeDefined();
        expect(entry?.requester).toEqual({
            id: requester.id, name: requester.name, email: requester.email, image: null,
        });
    });

    it('derives the requester\'s avatar image URL from their stored avatar hash', async () =>
    {
        const sha256 = 'cc'.repeat(32);
        await setAvatarSha256(booted, requester.id, sha256);
        await requestAccess(requester.cookie, folder, 'viewer');

        const res = await request(booted.app, 'GET', '/api/access-requests', owner.cookie);
        const body = await res.json() as { incoming : { requester : { image : string | null } }[] };

        expect(body.incoming[0]?.requester.image).toBe(`/api/avatars/${ sha256 }`);
    });

    it('carries the requester\'s message through the owner\'s incoming and requester\'s outgoing view', async () =>
    {
        await requestAccess(requester.cookie, folder, 'viewer', 'Could I get viewer access please?');

        const ownerRes = await request(booted.app, 'GET', '/api/access-requests', owner.cookie);
        const ownerView = await ownerRes.json() as { incoming : { request : Json }[] };
        const requesterRes = await request(booted.app, 'GET', '/api/access-requests', requester.cookie);
        const requesterView = await requesterRes.json() as { outgoing : Json[] };

        expect(ownerView.incoming[0]?.request['message']).toBe('Could I get viewer access please?');
        expect(requesterView.outgoing[0]?.['message']).toBe('Could I get viewer access please?');
    });

    it('carries a null message through when the requester asked without one', async () =>
    {
        await requestAccess(requester.cookie, folder, 'viewer');

        const res = await request(booted.app, 'GET', '/api/access-requests', owner.cookie);
        const body = await res.json() as { incoming : { request : Json }[] };

        expect(body.incoming[0]?.request['message']).toBeNull();
    });
});

//----------------------------------------------------------------------------------------------------------------------
// Resolution
//----------------------------------------------------------------------------------------------------------------------

describe('resolving a request', () =>
{
    it('lets the target owner grant, minting a share that gives the requester real access', async () =>
    {
        const created = await (await requestAccess(requester.cookie, folder, 'editor')).json() as Json;

        const grantRes = await request(booted.app, 'POST', `/api/access-requests/${ created.id }/grant`, owner.cookie);
        const readAfter = await request(booted.app, 'GET', `/api/nodes/${ folder }`, requester.cookie);

        expect(grantRes.status).toBe(200);
        expect((await grantRes.json() as Json).status).toBe('granted');
        // The mint carries the request's role, so the requester now resolves the node as an editor.
        expect(readAfter.status).toBe(200);
        expect((await readAfter.json() as Json).role).toBe('editor');
    });

    // The mint must carry the REQUEST's role. With only the editor case covered, a resolveRequest that hard-coded
    // 'editor' would pass; this pins the viewer request to a viewer grant.
    it('mints the requested role, not a fixed one, when granting a viewer request', async () =>
    {
        const created = await (await requestAccess(requester.cookie, folder, 'viewer')).json() as Json;

        await request(booted.app, 'POST', `/api/access-requests/${ created.id }/grant`, owner.cookie);
        const grantsRes = await request(booted.app, 'GET', `/api/nodes/${ folder }/shares`, owner.cookie);
        const grants = await grantsRes.json() as { shares : { share : { granteeUserID : string; role : string } }[] };
        const readAfter = await request(booted.app, 'GET', `/api/nodes/${ folder }`, requester.cookie);

        expect(grants.shares.find((entry) => entry.share.granteeUserID === requester.id)?.share.role).toBe('viewer');
        expect((await readAfter.json() as Json).role).toBe('viewer');
    });

    it('lets the target owner decline, resolving the request without granting access', async () =>
    {
        const created = await (await requestAccess(requester.cookie, folder, 'viewer')).json() as Json;

        const declinePath = `/api/access-requests/${ created.id }/decline`;
        const declineRes = await request(booted.app, 'POST', declinePath, owner.cookie);
        const readAfter = await request(booted.app, 'GET', `/api/nodes/${ folder }`, requester.cookie);

        expect(declineRes.status).toBe(200);
        expect((await declineRes.json() as Json).status).toBe('declined');
        expect(readAfter.status).toBe(404);
    });

    it('refuses resolution by anyone but the target owner', async () =>
    {
        const other = await makeUser(booted, 'other@example.com');
        const created = await (await requestAccess(requester.cookie, folder, 'viewer')).json() as Json;

        const res = await request(booted.app, 'POST', `/api/access-requests/${ created.id }/grant`, other.cookie);
        const body = await res.json() as { violations ?: { code : string }[] };

        expect(res.status).toBe(403);
        expect(body.violations?.some((violation) => violation.code === 'shareRequest.notOwner')).toBe(true);
    });

    it('refuses re-resolving an already-resolved request', async () =>
    {
        const created = await (await requestAccess(requester.cookie, folder, 'viewer')).json() as Json;
        await request(booted.app, 'POST', `/api/access-requests/${ created.id }/decline`, owner.cookie);

        const res = await request(booted.app, 'POST', `/api/access-requests/${ created.id }/grant`, owner.cookie);
        const body = await res.json() as { violations ?: { code : string }[] };

        expect(res.status).toBe(422);
        expect(body.violations?.some((violation) => violation.code === 'shareRequest.notPending')).toBe(true);
    });
});

//----------------------------------------------------------------------------------------------------------------------
