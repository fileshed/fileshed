//----------------------------------------------------------------------------------------------------------------------
// Node Sharing — what a node says about how far it currently reaches
//
// Every node a caller reads carries how far it reaches beyond its owner: how many people hold a grant, and the address
// of a live public link. Both are derived on every read, so a revoked grant or link stops being reported immediately --
// the case a stored flag gets wrong. Grants and links are the owner's to know, so a node the caller can see but does
// not own answers null: "not yours to know", which is a different statement from the owner's own zeros.
//
// Driven over the real serving app (real uploads, real grants, real links, real routes) -- the harness that can mint
// all three lives beside the public-link specs.
//----------------------------------------------------------------------------------------------------------------------

import { randomBytes } from 'node:crypto';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type {
    AccessTokenScope,
    CreateAccessTokenResponse,
    NodeListResponse,
    NodeResponse,
    PublicLinkResponse,
} from '@fileshed/core';

// Support
import {
    type BootedServeApp,
    ORIGIN,
    type TestUser,
    bootServeApp,
    createFolder,
    createLink,
    makeUser,
    revokeLink,
    shareWith,
    trashNode,
    uploadFile,
} from '../publicLinks/support.ts';

//----------------------------------------------------------------------------------------------------------------------

const NOTHING_SHARED = { granteeCount: 0, linkUrl: null };

let booted : BootedServeApp;
let owner : TestUser;
let friend : TestUser;
let colleague : TestUser;

beforeEach(async () =>
{
    booted = await bootServeApp();
    owner = await makeUser(booted, 'owner@example.com');
    friend = await makeUser(booted, 'friend@example.com');
    colleague = await makeUser(booted, 'colleague@example.com');
});

afterEach(async () =>
{
    await booted.cleanup();
});

//----------------------------------------------------------------------------------------------------------------------

async function listRoot(user : TestUser) : Promise<NodeListResponse>
{
    const res = await booted.app.request(`${ ORIGIN }/api/nodes/children`, { headers: { cookie: user.cookie } });

    return res.json() as Promise<NodeListResponse>;
}

async function listChildren(user : TestUser, parentID : string) : Promise<NodeListResponse>
{
    const res = await booted.app.request(`${ ORIGIN }/api/nodes/${ parentID }/children`, {
        headers: { cookie: user.cookie },
    });

    return res.json() as Promise<NodeListResponse>;
}

async function listTrash(user : TestUser) : Promise<NodeListResponse>
{
    const res = await booted.app.request(`${ ORIGIN }/api/trash`, { headers: { cookie: user.cookie } });

    return res.json() as Promise<NodeListResponse>;
}

function getNode(user : TestUser, nodeID : string) : Promise<Response>
{
    return booted.app.request(`${ ORIGIN }/api/nodes/${ nodeID }`, { headers: { cookie: user.cookie } });
}

function renameNode(user : TestUser, nodeID : string, name : string) : Promise<Response>
{
    return booted.app.request(`${ ORIGIN }/api/nodes/${ nodeID }`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', 'cookie': user.cookie },
        body: JSON.stringify({ name }),
    });
}

// One node out of a listing, by id -- the assertions are about what a particular node says about itself.
function nodeIn(listing : NodeListResponse, nodeID : string) : NodeResponse | undefined
{
    return listing.nodes.find((node) => node.id === nodeID);
}

async function uploadOwned(name : string, parentID ?: string) : Promise<string>
{
    const uploaded = await uploadFile(booted, owner, randomBytes(32), { name, parentID });

    return uploaded.node.id;
}

async function mintLink(user : TestUser, nodeID : string) : Promise<PublicLinkResponse>
{
    return (await createLink(booted, user, nodeID)).json() as Promise<PublicLinkResponse>;
}

// A real access token, minted over the real endpoint at the scopes the spec names -- so what the key may see is
// decided by the shipped statement machinery, not by a hand-built permission blob.
async function mintToken(user : TestUser, scopes : AccessTokenScope[]) : Promise<string>
{
    const res = await booted.app.request(`${ ORIGIN }/api/me/access-tokens`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'cookie': user.cookie },
        body: JSON.stringify({ name: scopes.join('+'), scopes, expiresInDays: null }),
    });

    return ((await res.json()) as CreateAccessTokenResponse).token;
}

function requestAs(token : string, path : string) : Promise<Response>
{
    return booted.app.request(`${ ORIGIN }${ path }`, { headers: { authorization: `Bearer ${ token }` } });
}

//----------------------------------------------------------------------------------------------------------------------
// What a listed node says
//----------------------------------------------------------------------------------------------------------------------

describe('sharing on a folder listing', () =>
{
    it('reports a grant count, a live link, or both -- and zeros for a node with neither', async () =>
    {
        const sharedID = await uploadOwned('shared.bin');
        const linkedID = await uploadOwned('linked.bin');
        const bothID = await uploadOwned('both.bin');
        const privateID = await uploadOwned('private.bin');

        await shareWith(booted, owner, sharedID, friend.id);
        await shareWith(booted, owner, bothID, friend.id);
        await shareWith(booted, owner, bothID, colleague.id);
        const link = await mintLink(owner, linkedID);
        const bothLink = await mintLink(owner, bothID);

        const listing = await listRoot(owner);

        expect(nodeIn(listing, sharedID)?.sharing).toEqual({ granteeCount: 1, linkUrl: null });
        expect(nodeIn(listing, linkedID)?.sharing).toEqual({ granteeCount: 0, linkUrl: `/d/${ link.token }` });
        expect(nodeIn(listing, bothID)?.sharing).toEqual({ granteeCount: 2, linkUrl: `/d/${ bothLink.token }` });
        expect(nodeIn(listing, privateID)?.sharing).toEqual(NOTHING_SHARED);
    });

    // The two answers are not interchangeable: zeros are the owner stating that nothing is shared, null is the API
    // declining to say. A caller that cannot tell them apart cannot tell an unshared file from someone else's.
    it('answers zeros for an owned node and null for one the caller merely reads', async () =>
    {
        const folder = await createFolder(booted, owner, 'collab');
        await shareWith(booted, owner, folder.id, friend.id, 'editor');
        const mine = await uploadOwned('mine.bin', folder.id);

        const asOwner = nodeIn(await listChildren(owner, folder.id), mine);
        const asGuest = nodeIn(await listChildren(friend, folder.id), mine);

        expect(asOwner?.sharing).toEqual(NOTHING_SHARED);
        expect(asGuest?.sharing).toBeNull();
    });

    // The reason sharing is computed rather than stored: the moment the link is revoked the node is no longer
    // published, and the very next read has to say so.
    it('stops reporting a link the moment it is revoked', async () =>
    {
        const nodeID = await uploadOwned('linked.bin');
        const link = await mintLink(owner, nodeID);

        expect(nodeIn(await listRoot(owner), nodeID)?.sharing?.linkUrl).toBe(`/d/${ link.token }`);

        await revokeLink(booted, owner, link.id);

        expect(nodeIn(await listRoot(owner), nodeID)?.sharing).toEqual(NOTHING_SHARED);
    });

    it('stops counting a grant the moment it is revoked', async () =>
    {
        const nodeID = await uploadOwned('shared.bin');
        const grantRes = await shareWith(booted, owner, nodeID, friend.id);
        const share = await grantRes.json() as { id : string };

        expect(nodeIn(await listRoot(owner), nodeID)?.sharing?.granteeCount).toBe(1);

        await booted.app.request(`${ ORIGIN }/api/shares/${ share.id }`, {
            method: 'DELETE',
            headers: { cookie: owner.cookie },
        });

        expect(nodeIn(await listRoot(owner), nodeID)?.sharing).toEqual(NOTHING_SHARED);
    });

    // Only a direct owner may list a node's grants or its links, so a listing must not report either for someone
    // else's node -- not even one sitting in the caller's own folder, and not even when it is publicly linked.
    it('says nothing about a node the caller does not own', async () =>
    {
        const folder = await createFolder(booted, owner, 'collab');
        await shareWith(booted, owner, folder.id, friend.id, 'editor');

        const contribution = await uploadFile(booted, friend, randomBytes(16), {
            name: 'theirs.bin',
            parentID: folder.id,
        });
        await mintLink(friend, contribution.node.id);
        await shareWith(booted, friend, contribution.node.id, colleague.id);

        const listing = await listChildren(owner, folder.id);

        expect(listing.nodes.map((node) => node.id)).toContain(contribution.node.id);
        expect(nodeIn(listing, contribution.node.id)?.sharing).toBeNull();
    });

    // A trashed node serves nothing publicly and is hidden from every recipient, so it reaches no one -- zeros, not
    // the grants and link still sitting on the row.
    it('reports zeros in the trash, even for a node that was shared and linked', async () =>
    {
        const nodeID = await uploadOwned('doomed.bin');
        await shareWith(booted, owner, nodeID, friend.id);
        await mintLink(owner, nodeID);

        await trashNode(booted, owner, nodeID);
        const trash = await listTrash(owner);

        expect(trash.nodes.map((node) => node.id)).toContain(nodeID);
        expect(nodeIn(trash, nodeID)?.sharing).toEqual(NOTHING_SHARED);
    });
});

//----------------------------------------------------------------------------------------------------------------------
// The access-token plane -- a link URL is the capability itself, so sharing answers to the sharing scope even though
// the listing it rides answers to the files scope.
//----------------------------------------------------------------------------------------------------------------------

describe('sharing under an access token', () =>
{
    it('withholds sharing from a key that may read files but not shares', async () =>
    {
        const nodeID = await uploadOwned('report.bin');
        await shareWith(booted, owner, nodeID, friend.id);
        await mintLink(owner, nodeID);
        const token = await mintToken(owner, [ 'files:read' ]);

        const res = await requestAs(token, '/api/nodes/children');
        const listing = await res.json() as NodeListResponse;

        expect(res.status).toBe(200);
        expect(listing.nodes.map((node) => node.id)).toContain(nodeID);

        // Null, not zeros: the key is being declined, not told the file is unshared.
        expect(nodeIn(listing, nodeID)?.sharing).toBeNull();
    });

    it('carries sharing for a key that may read shares', async () =>
    {
        const nodeID = await uploadOwned('report.bin');
        await shareWith(booted, owner, nodeID, friend.id);
        const link = await mintLink(owner, nodeID);
        const token = await mintToken(owner, [ 'files:read', 'shares:read' ]);

        const listing = await (await requestAs(token, '/api/nodes/children')).json() as NodeListResponse;

        expect(nodeIn(listing, nodeID)?.sharing).toEqual({ granteeCount: 1, linkUrl: `/d/${ link.token }` });
    });

    it('withholds sharing on a single-node read from a key that may read files but not shares', async () =>
    {
        const nodeID = await uploadOwned('report.bin');
        await mintLink(owner, nodeID);
        const token = await mintToken(owner, [ 'files:read' ]);

        const res = await requestAs(token, `/api/nodes/${ nodeID }`);

        expect(res.status).toBe(200);
        expect((await res.json() as NodeResponse).sharing).toBeNull();
    });
});

//----------------------------------------------------------------------------------------------------------------------
// The single-node read, and the responses that report a node after changing it
//----------------------------------------------------------------------------------------------------------------------

describe('sharing on a single node', () =>
{
    it('tells the owner what the node currently shares', async () =>
    {
        const nodeID = await uploadOwned('report.bin');
        await shareWith(booted, owner, nodeID, friend.id);
        const link = await mintLink(owner, nodeID);

        const res = await getNode(owner, nodeID);

        expect(res.status).toBe(200);
        expect((await res.json() as NodeResponse).sharing)
            .toEqual({ granteeCount: 1, linkUrl: `/d/${ link.token }` });
    });

    it('says null to someone who can read the node but does not own it', async () =>
    {
        const nodeID = await uploadOwned('report.bin');
        await shareWith(booted, owner, nodeID, friend.id);
        await mintLink(owner, nodeID);

        const res = await getNode(friend, nodeID);

        expect(res.status).toBe(200);
        expect((await res.json() as NodeResponse).sharing).toBeNull();
    });

    // A rename answers with the node it just changed, and the client writes that answer straight back into the row on
    // screen. Reporting null there would blank a badge the file still earns.
    it('carries the file\'s real sharing on the response to a rename', async () =>
    {
        const nodeID = await uploadOwned('before.bin');
        await shareWith(booted, owner, nodeID, friend.id);
        const link = await mintLink(owner, nodeID);

        const res = await renameNode(owner, nodeID, 'after.bin');
        const renamed = await res.json() as NodeResponse;

        expect(res.status).toBe(200);
        expect(renamed.name).toBe('after.bin');
        expect(renamed.sharing).toEqual({ granteeCount: 1, linkUrl: `/d/${ link.token }` });
    });

    // A trashed node reaches no one -- its links serve nothing and recipients cannot see it -- so the single-node read
    // agrees with the trash listing rather than reporting the grants and link still on the row.
    it('reports zeros for a trashed node, even to its owner', async () =>
    {
        const nodeID = await uploadOwned('doomed.bin');
        await shareWith(booted, owner, nodeID, friend.id);
        await mintLink(owner, nodeID);
        await trashNode(booted, owner, nodeID);

        const res = await getNode(owner, nodeID);

        expect(res.status).toBe(200);
        expect((await res.json() as NodeResponse).sharing).toEqual(NOTHING_SHARED);
    });

    // The same read-as-absent doctrine every other node read applies: no access is a 404 that never confirms the
    // node exists.
    it('reads as absent for someone with no access to the node', async () =>
    {
        const nodeID = await uploadOwned('report.bin');

        expect((await getNode(colleague, nodeID)).status).toBe(404);
    });
});

//----------------------------------------------------------------------------------------------------------------------
