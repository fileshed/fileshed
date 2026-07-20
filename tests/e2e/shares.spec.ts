//----------------------------------------------------------------------------------------------------------------------
// E2E — Shares, permission inheritance, contributions, requests, and leave
//
// Two (then three) users over real sockets exercise the sharing lifecycle: an owner grants viewer on a folder -> the
// grantee reads its contents with the inherited role on every node but cannot create inside (parent.crossOwner -> 403);
// upgraded to editor, the grantee uploads INTO the shared folder and that contribution -- owned by the grantee,
// parented in the owner's subtree -- lists and reads as 'owner' for the folder owner while a stranger cannot resolve it
// at all, and is charged to the grantee's quota, not the owner's; Shared with me lists the grant; a third user's access
// request is granted by the owner and unlocks their read; revoking the contributor's grant costs them the folder but
// never their own contribution; and leaving a share drops access.
//
// The scenario is a sequence of state transitions on one server, so beforeAll runs the whole script and records what
// each step observed. Anything whose answer CHANGES as the script advances (the viewer-only reads, the stranger's
// pre-grant 404s, Shared with me before the revoke) is captured at the moment it is true; assertions that hold at any
// point stay live reads in their own test. No test produces state another test consumes, so a failure reports itself
// instead of cascading into undefined, and a single test still runs under -t.
//----------------------------------------------------------------------------------------------------------------------

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type {
    AccessRequestListResponse,
    AccessRequestResponse,
    ClaimResponse,
    MeResponse,
    NodeListResponse,
    NodeResponse,
    ShareResponse,
    SharedWithMeResponse,
} from '@fileshed/core';

// Support
import { ApiClient, type ServerHandle, sha256Of, smallFixture, spawnServer, withDb } from './support.ts';

//----------------------------------------------------------------------------------------------------------------------

const PASSWORD = 'correct-horse-battery';

const ownerFile = smallFixture('shares-owner-file');
const contribFile = smallFixture('shares-grantee-contrib');

let server : ServerHandle;

let owner : ApiClient;
let grantee : ApiClient;
let stranger : ApiClient;
let ownerID : string;
let granteeID : string;
let strangerID : string;

let folderID : string;
let viewerShareID : string;
let contributionID : string;

// Observations recorded by the scripted flow, each taken at the point where its answer is the one under test.
let viewerGrant : ShareResponse;
let viewerGrantStatus : number;
let viewerListing : NodeListResponse;
let viewerListingStatus : number;
let viewerCreateStatus : number;
let editorGrant : ShareResponse;
let editorGrantStatus : number;
let contribution : NodeResponse;
let strangerContributionStatus : number;
let strangerFolderStatusBeforeGrant : number;
let sharedWithMe : SharedWithMeResponse;
let sharedWithMeStatus : number;
let accessRequest : AccessRequestResponse;
let accessRequestStatus : number;
let ownerIncoming : AccessRequestListResponse;
let ownerIncomingStatus : number;

async function callerID(client : ApiClient) : Promise<string>
{
    const me = await (await client.get('/api/me')).json() as MeResponse;
    return me.id;
}

async function quotaUsed(client : ApiClient) : Promise<number>
{
    const me = await (await client.get('/api/me')).json() as MeResponse;
    return me.quota.used;
}

// Claim -> ticket -> PUT, returning the committed file node. Both fixtures are small (< 1 MiB), so the claim always
// answers with a ticket rather than a proof challenge.
async function upload(
    client : ApiClient,
    parentID : string | null,
    name : string,
    bytes : Buffer
) : Promise<NodeResponse>
{
    const claim = await (await client.post('/api/blobs/claim', { sha256: sha256Of(bytes), size: bytes.length }))
        .json() as ClaimResponse;
    if(claim.upload !== true) { throw new Error('expected an upload ticket'); }

    const params = new URLSearchParams({ name, mimeType: 'application/octet-stream' });
    if(parentID !== null) { params.set('parentID', parentID); }

    return await (await client.put(`/api/uploads/${ claim.ticket }?${ params.toString() }`, bytes))
        .json() as NodeResponse;
}

function grantShare(nodeID : string, granteeUserID : string, role : 'viewer' | 'editor') : Promise<Response>
{
    return owner.post(`/api/nodes/${ nodeID }/shares`, { granteeUserID, role });
}

//----------------------------------------------------------------------------------------------------------------------

beforeAll(async () =>
{
    server = await spawnServer();

    owner = new ApiClient(server.baseURL);
    grantee = new ApiClient(server.baseURL);
    stranger = new ApiClient(server.baseURL);
    await owner.signUp('owner@example.com', PASSWORD);
    await grantee.signUp('grantee@example.com', PASSWORD);
    await stranger.signUp('stranger@example.com', PASSWORD);
    ownerID = await callerID(owner);
    granteeID = await callerID(grantee);
    strangerID = await callerID(stranger);

    folderID = (await (await owner.post('/api/nodes', { type: 'folder', name: 'team', parentID: null }))
        .json() as NodeResponse).id;
    await upload(owner, folderID, 'brief.bin', ownerFile);

    // Viewer: read the shared folder, but no write. Both observations expire the moment the grant is upgraded below.
    const viewerGrantRes = await grantShare(folderID, granteeID, 'viewer');
    viewerGrantStatus = viewerGrantRes.status;
    viewerGrant = await viewerGrantRes.json() as ShareResponse;
    viewerShareID = viewerGrant.id;

    const viewerListingRes = await grantee.get(`/api/nodes/${ folderID }/children`);
    viewerListingStatus = viewerListingRes.status;
    viewerListing = await viewerListingRes.json() as NodeListResponse;

    viewerCreateStatus = (await grantee.post('/api/nodes', {
        type: 'folder',
        name: 'nope',
        parentID: folderID,
    })).status;

    // Editor: the grantee may now contribute into the owner's folder.
    const editorGrantRes = await grantShare(folderID, granteeID, 'editor');
    editorGrantStatus = editorGrantRes.status;
    editorGrant = await editorGrantRes.json() as ShareResponse;

    contribution = await upload(grantee, folderID, 'contribution.bin', contribFile);
    contributionID = contribution.id;

    // The stranger's no-access reads, taken before their access request is granted further down.
    strangerContributionStatus = (await stranger.get(`/api/nodes/${ contributionID }`)).status;
    strangerFolderStatusBeforeGrant = (await stranger.get(`/api/nodes/${ folderID }`)).status;

    // Shared with me, while the grantee's grant is still live (the revoke test ends it).
    const sharedRes = await grantee.get('/api/shared-with-me');
    sharedWithMeStatus = sharedRes.status;
    sharedWithMe = await sharedRes.json() as SharedWithMeResponse;

    const requestRes = await stranger.post(`/api/nodes/${ folderID }/access-requests`, { requestedRole: 'viewer' });
    accessRequestStatus = requestRes.status;
    accessRequest = await requestRes.json() as AccessRequestResponse;

    const incomingRes = await owner.get('/api/access-requests');
    ownerIncomingStatus = incomingRes.status;
    ownerIncoming = await incomingRes.json() as AccessRequestListResponse;
});

afterAll(async () =>
{
    await server?.stop();
});

//----------------------------------------------------------------------------------------------------------------------
// Viewer: inherited read, but no write
//----------------------------------------------------------------------------------------------------------------------

describe('viewer grant', () =>
{
    it('grants viewer to a second user', () =>
    {
        expect(viewerGrantStatus).toBe(201);
        expect(viewerGrant.nodeID).toBe(folderID);
        expect(viewerGrant.granteeUserID).toBe(granteeID);
        expect(viewerGrant.role).toBe('viewer');
    });

    it('lets the viewer read the shared folder\'s children with the inherited role on each node', () =>
    {
        expect(viewerListingStatus).toBe(200);
        const file = viewerListing.nodes.find((node) => node.name === 'brief.bin');

        expect(file?.type).toBe('file');
        // The folder's viewer grant is inherited by every child.
        expect(file?.role).toBe('viewer');
    });

    it('refuses a viewer creating a folder inside the shared folder (parent.crossOwner -> 403)', () =>
    {
        expect(viewerCreateStatus).toBe(403);
    });
});

//----------------------------------------------------------------------------------------------------------------------
// Editor: contribution into a shared folder
//----------------------------------------------------------------------------------------------------------------------

describe('editor contribution', () =>
{
    it('upgrades the grant to editor in place', () =>
    {
        expect(editorGrantStatus).toBe(201);
        expect(editorGrant.role).toBe('editor');
        // Re-granting an existing grantee updates the role in place; the share id is preserved.
        expect(editorGrant.id).toBe(viewerShareID);
    });

    it('commits the editor\'s upload into the shared folder, owned by the editor', () =>
    {
        expect(contribution.type).toBe('file');
        expect(contribution.ownerID).toBe(granteeID);
        expect(contribution.parentID).toBe(folderID);
    });

    it('places the contribution as a cross-owner node in the owner\'s subtree', async () =>
    {
        const row = await withDb(server, (db) => db
            .selectFrom('node')
            .select([ 'owner_id', 'parent_id' ])
            .where('id', '=', contributionID)
            .executeTakeFirstOrThrow());
        const folder = await withDb(server, (db) => db
            .selectFrom('node')
            .select('owner_id')
            .where('id', '=', folderID)
            .executeTakeFirstOrThrow());

        // The contribution is owned by the grantee but parented in the owner's folder -- the one sanctioned cross-owner
        // parent edge, which no HTTP response states outright.
        expect(row.owner_id).toBe(granteeID);
        expect(row.parent_id).toBe(folderID);
        expect(folder.owner_id).toBe(ownerID);
        expect(row.owner_id).not.toBe(folder.owner_id);
    });

    it('shows the contribution to the folder owner in the folder listing', async () =>
    {
        const res = await owner.get(`/api/nodes/${ folderID }/children`);
        const listing = await res.json() as NodeListResponse;

        expect(res.status).toBe(200);
        const listed = listing.nodes.find((node) => node.id === contributionID);

        // The item travels with the folder: a foreign-owned node still lists, and the folder owner resolves 'owner'
        // on it through ownership of its ancestor.
        expect(listed).toBeDefined();
        expect(listed?.ownerID).toBe(granteeID);
        expect(listed?.role).toBe('owner');
    });

    it('lets the folder owner read the contribution directly, but not a stranger', async () =>
    {
        const res = await owner.get(`/api/nodes/${ contributionID }`);
        const node = await res.json() as NodeResponse;

        expect(res.status).toBe(200);
        expect(node.role).toBe('owner');

        // No ownership anywhere in its chain and no grant: the node reads as absent.
        expect(strangerContributionStatus).toBe(404);
    });

    it('charges the contribution to the grantee\'s quota, not the owner\'s', async () =>
    {
        // The owner is charged only for their own file; the grantee is charged for the contribution they own.
        expect(await quotaUsed(owner)).toBe(ownerFile.length);
        expect(await quotaUsed(grantee)).toBe(contribFile.length);
    });

    it('lets the grantee read their own contribution as its owner', async () =>
    {
        const res = await grantee.get(`/api/nodes/${ contributionID }`);
        const node = await res.json() as NodeResponse;

        expect(res.status).toBe(200);
        expect(node.role).toBe('owner');
    });
});

//----------------------------------------------------------------------------------------------------------------------
// Shared with me
//----------------------------------------------------------------------------------------------------------------------

describe('shared with me', () =>
{
    it('lists the grant with the sharer as the target owner and no placement yet', () =>
    {
        expect(sharedWithMeStatus).toBe(200);
        const entry = sharedWithMe.entries.find((candidate) => candidate.share.nodeID === folderID);

        expect(entry).toBeDefined();
        expect(entry?.target.ownerID).toBe(ownerID);
        // Placement is independent of the grant: the grantee has not created a link to the shared folder.
        expect(entry?.placed).toBe(false);
    });
});

//----------------------------------------------------------------------------------------------------------------------
// Access requests
//----------------------------------------------------------------------------------------------------------------------

describe('access request lifecycle', () =>
{
    it('records a third user\'s request as pending', () =>
    {
        expect(accessRequestStatus).toBe(201);
        expect(accessRequest.status).toBe('pending');
        expect(accessRequest.requesterID).toBe(strangerID);
    });

    it('surfaces the pending request to the target owner', () =>
    {
        expect(ownerIncomingStatus).toBe(200);
        expect(ownerIncoming.incoming.map((request) => request.id)).toContain(accessRequest.id);
    });

    it('leaves the requester unable to read the folder before the grant', () =>
    {
        expect(strangerFolderStatusBeforeGrant).toBe(404);
    });

    it('grants the request and unlocks the requester\'s read', async () =>
    {
        const grantRes = await owner.post(`/api/access-requests/${ accessRequest.id }/grant`, {});
        const resolved = await grantRes.json() as AccessRequestResponse;

        expect(grantRes.status).toBe(200);
        expect(resolved.status).toBe('granted');
        expect(resolved.resolvedAt).not.toBeNull();

        const readRes = await stranger.get(`/api/nodes/${ folderID }`);
        const node = await readRes.json() as NodeResponse;

        expect(readRes.status).toBe(200);
        expect(node.role).toBe('viewer');
    });
});

//----------------------------------------------------------------------------------------------------------------------
// Revoking a contributor
//----------------------------------------------------------------------------------------------------------------------

describe('revoking a contributor', () =>
{
    it('costs the contributor the folder but never their own contribution', async () =>
    {
        const revokeRes = await owner.del(`/api/shares/${ viewerShareID }`);
        expect(revokeRes.status).toBe(204);

        // They lose access to the folder like anyone else...
        expect((await grantee.get(`/api/nodes/${ folderID }`)).status).toBe(404);

        // ...but the item they contributed remains theirs, still in the folder, still charged to them.
        const res = await grantee.get(`/api/nodes/${ contributionID }`);
        const node = await res.json() as NodeResponse;

        expect(res.status).toBe(200);
        expect(node.role).toBe('owner');
        expect(node.parentID).toBe(folderID);
        expect(await quotaUsed(grantee)).toBe(contribFile.length);
    });
});

//----------------------------------------------------------------------------------------------------------------------
// Leave
//----------------------------------------------------------------------------------------------------------------------

describe('leave', () =>
{
    it('drops the grantee\'s access when they leave the share', async () =>
    {
        // Arrange a live grant to leave: re-granting mints one after the revoke test, and updates the existing row in
        // place if this test runs on its own.
        const share = await (await grantShare(folderID, granteeID, 'viewer')).json() as ShareResponse;

        const leaveRes = await grantee.post(`/api/shares/${ share.id }/leave`, {});
        expect(leaveRes.status).toBe(204);

        expect((await grantee.get(`/api/nodes/${ folderID }`)).status).toBe(404);
    });
});

//----------------------------------------------------------------------------------------------------------------------
