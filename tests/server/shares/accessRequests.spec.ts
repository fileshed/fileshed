//----------------------------------------------------------------------------------------------------------------------
// Share requests
//
// A user who can see a stub but cannot resolve it asks the target's OWNER for access; the owner grants (minting an
// ordinary share) or declines. Expectations: a requester must lack access, no duplicate pending request per
// (node, requester), only the target's owner may resolve, and granting mints a share that gives the requester real
// access. Driven end to end; not the implementation.
//----------------------------------------------------------------------------------------------------------------------

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

// Support
import {
    type BootedShareApp,
    type TestUser,
    bootShareApp,
    createFolder,
    grantShare,
    makeUser,
    request,
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

function requestAccess(cookie : string, nodeID : string, role : 'viewer' | 'editor') : Promise<Response>
{
    return request(booted.app, 'POST', `/api/nodes/${ nodeID }/access-requests`, cookie, { requestedRole: role });
}

//----------------------------------------------------------------------------------------------------------------------
// Asking for access
//----------------------------------------------------------------------------------------------------------------------

describe('POST /api/nodes/:id/access-requests', () =>
{
    it('records a pending request from a user who lacks access', async () =>
    {
        const res = await requestAccess(requester.cookie, folder, 'viewer');
        const body = await res.json() as Json;

        expect(res.status).toBe(201);
        expect(body).toMatchObject({
            nodeID: folder,
            requesterID: requester.id,
            requestedRole: 'viewer',
            status: 'pending',
            resolvedAt: null,
        });
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
        const grants = await grantsRes.json() as { shares : { granteeUserID : string; role : string }[] };
        const readAfter = await request(booted.app, 'GET', `/api/nodes/${ folder }`, requester.cookie);

        expect(grants.shares.find((share) => share.granteeUserID === requester.id)?.role).toBe('viewer');
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
