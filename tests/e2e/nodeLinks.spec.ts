//----------------------------------------------------------------------------------------------------------------------
// E2E — Link nodes: stub resolution, healing, cascade death, and creation legality
//
// The type:'link' subsystem over real sockets. A recipient of a shared folder places a link to an item inside it; the
// link resolves in a listing while the share is live, renders as a stub (resolved target null, its own row intact) the
// moment the owner revokes, and heals in place when access returns -- dangling-symlink semantics, no row churn. Hard-
// deleting the target is the only permanent death: the FK cascade removes every link pointing at it, across user trees,
// so the recipient's link row is gone. Deleting your own link is "remove from my drive" -- the target and the share it
// rode in on are untouched, and the grant still lists in Shared with me. Finally the creation-time regulation over the
// wire: a target the creator cannot resolve is refused (403), a link may not target another link (422), and a self-link
// onto a node you own is allowed (201).
//----------------------------------------------------------------------------------------------------------------------

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { ClaimResponse, MeResponse, NodeListResponse, NodeResponse, ShareResponse } from '@fileshed/core';

// Support
import { ApiClient, type ServerHandle, sha256Of, smallFixture, spawnServer, withDb } from './support.ts';

//----------------------------------------------------------------------------------------------------------------------

const PASSWORD = 'correct-horse-battery';

let server : ServerHandle;

let owner : ApiClient;
let recipient : ApiClient;
let stranger : ApiClient;
let recipientID : string;

async function callerID(client : ApiClient) : Promise<string>
{
    const me = await (await client.get('/api/me')).json() as MeResponse;
    return me.id;
}

async function makeFolder(client : ApiClient, name : string) : Promise<NodeResponse>
{
    return await (await client.post('/api/nodes', { type: 'folder', name, parentID: null })).json() as NodeResponse;
}

// Claim -> ticket -> PUT for a small (< 1 MiB) fixture, which always answers with a ticket rather than a challenge.
async function upload(
    client : ApiClient,
    parentID : string | null,
    name : string,
    bytes : Buffer
) : Promise<NodeResponse>
{
    const claim = await (await client.post('/api/blobs/claim', { sha256: sha256Of(bytes), size: bytes.length }))
        .json() as ClaimResponse;
    if(claim.upload !== true) { throw new Error('setup: expected an upload ticket'); }

    const params = new URLSearchParams({ name, mimeType: 'application/octet-stream' });
    if(parentID !== null) { params.set('parentID', parentID); }

    return await (await client.put(`/api/uploads/${ claim.ticket }?${ params.toString() }`, bytes))
        .json() as NodeResponse;
}

function grantShare(nodeID : string, granteeUserID : string, role : 'viewer' | 'editor') : Promise<Response>
{
    return owner.post(`/api/nodes/${ nodeID }/shares`, { granteeUserID, role });
}

// The recipient's own root listing, where their placed links live.
async function recipientRoot() : Promise<NodeListResponse>
{
    return await (await recipient.get('/api/nodes/children')).json() as NodeListResponse;
}

// A shared folder with one file inside it, plus the recipient's link to that file placed in their own root. Distinct
// seeds per scenario keep each test's blob and nodes independent.
interface SharedLinkFixture
{
    folderID : string;
    childID : string;
    share : ShareResponse;
    linkID : string;
}

async function placeLinkIntoSharedFolder(seed : string, role : 'viewer' | 'editor') : Promise<SharedLinkFixture>
{
    const folder = await makeFolder(owner, `folder-${ seed }`);
    const child = await upload(owner, folder.id, `child-${ seed }.bin`, smallFixture(`nodelink-${ seed }`));

    const share = await (await grantShare(folder.id, recipientID, role)).json() as ShareResponse;

    const link = await (await recipient.post('/api/nodes', {
        type: 'link',
        parentID: null,
        targetNodeID: child.id,
    })).json() as NodeResponse;

    return { folderID: folder.id, childID: child.id, share, linkID: link.id };
}

//----------------------------------------------------------------------------------------------------------------------

beforeAll(async () =>
{
    server = await spawnServer();

    owner = new ApiClient(server.baseURL);
    recipient = new ApiClient(server.baseURL);
    stranger = new ApiClient(server.baseURL);
    await owner.signUp('link-owner@example.com', PASSWORD);
    await recipient.signUp('link-recipient@example.com', PASSWORD);
    await stranger.signUp('link-stranger@example.com', PASSWORD);
    recipientID = await callerID(recipient);
});

afterAll(async () =>
{
    await server?.stop();
});

//----------------------------------------------------------------------------------------------------------------------
// Dead-link stub resolution and healing
//----------------------------------------------------------------------------------------------------------------------

describe('a link to a shared item', () =>
{
    it('resolves while the share is live, stubs on revoke without losing its row, and heals on re-grant', async () =>
    {
        const { folderID, childID, share, linkID } = await placeLinkIntoSharedFolder('heal', 'viewer');

        // Live share: the link resolves, carrying the target's summary.
        const listedLive = (await recipientRoot()).nodes.find((node) => node.id === linkID);
        expect(listedLive?.type).toBe('link');
        if(listedLive?.type !== 'link') { throw new Error('expected a link node'); }
        expect(listedLive.targetNodeID).toBe(childID);
        expect(listedLive.target?.id).toBe(childID);
        expect(listedLive.target?.type).toBe('file');

        // Revoke: the target no longer resolves for the recipient, so the link renders as a stub -- but its row stays.
        expect((await owner.del(`/api/shares/${ share.id }`)).status).toBe(204);

        const listedDead = (await recipientRoot()).nodes.find((node) => node.id === linkID);
        expect(listedDead?.type).toBe('link');
        if(listedDead?.type !== 'link') { throw new Error('expected a link node'); }
        expect(listedDead.targetNodeID).toBe(childID);
        expect(listedDead.target).toBeNull();

        const rowWhileDead = await withDb(server, (db) => db
            .selectFrom('node')
            .select([ 'id', 'target_node_id' ])
            .where('id', '=', linkID)
            .executeTakeFirst());
        expect(rowWhileDead?.id).toBe(linkID);
        expect(rowWhileDead?.target_node_id).toBe(childID);

        // Re-grant heals resolution in place: the link resolves again, and its row is the same one -- no churn.
        expect((await grantShare(folderID, recipientID, 'viewer')).status).toBe(201);

        const listedHealed = (await recipientRoot()).nodes.find((node) => node.id === linkID);
        expect(listedHealed?.type).toBe('link');
        if(listedHealed?.type !== 'link') { throw new Error('expected a link node'); }
        expect(listedHealed.target?.id).toBe(childID);
    });
});

//----------------------------------------------------------------------------------------------------------------------
// Hard-deleting the target
//----------------------------------------------------------------------------------------------------------------------

describe('hard-deleting a link target', () =>
{
    it('removes the recipient\'s link row by FK cascade across trees', async () =>
    {
        const { childID, linkID } = await placeLinkIntoSharedFolder('cascade', 'viewer');

        // The link exists before the delete.
        const before = await withDb(server, (db) => db
            .selectFrom('node')
            .select('id')
            .where('id', '=', linkID)
            .executeTakeFirst());
        expect(before?.id).toBe(linkID);

        // The owner permanently deletes the target file. target_node_id ON DELETE CASCADE takes the link with it.
        expect((await owner.del(`/api/nodes/${ childID }`)).status).toBe(204);

        const linkRow = await withDb(server, (db) => db
            .selectFrom('node')
            .select('id')
            .where('id', '=', linkID)
            .executeTakeFirst());
        expect(linkRow).toBeUndefined();
    });
});

//----------------------------------------------------------------------------------------------------------------------
// Remove from my drive
//----------------------------------------------------------------------------------------------------------------------

describe('deleting your own link', () =>
{
    it('removes the placement only, leaving the target, the share, and Shared with me intact', async () =>
    {
        const { folderID, childID, share, linkID } = await placeLinkIntoSharedFolder('remove', 'viewer');

        // "Remove from my drive": the recipient deletes their own link node.
        expect((await recipient.del(`/api/nodes/${ linkID }`)).status).toBe(204);

        const linkRow = await withDb(server, (db) => db
            .selectFrom('node')
            .select('id')
            .where('id', '=', linkID)
            .executeTakeFirst());
        expect(linkRow).toBeUndefined();

        // The target node and the share row are untouched -- deleting a link is placement-only.
        const targetRow = await withDb(server, (db) => db
            .selectFrom('node')
            .select('id')
            .where('id', '=', childID)
            .executeTakeFirst());
        expect(targetRow?.id).toBe(childID);

        const shareRow = await withDb(server, (db) => db
            .selectFrom('share')
            .select('id')
            .where('id', '=', share.id)
            .executeTakeFirst());
        expect(shareRow?.id).toBe(share.id);

        // The grant still lists in Shared with me, re-placeable anytime.
        const swm = await (await recipient.get('/api/shared-with-me'))
            .json() as { entries : { share : ShareResponse }[] };
        expect(swm.entries.some((entry) => entry.share.nodeID === folderID)).toBe(true);
    });
});

//----------------------------------------------------------------------------------------------------------------------
// Link-creation legality
//----------------------------------------------------------------------------------------------------------------------

describe('link creation regulation', () =>
{
    it('refuses a link to a target the creator cannot resolve with 403', async () =>
    {
        const priv = await makeFolder(owner, 'private-unshared');

        const res = await stranger.post('/api/nodes', { type: 'link', parentID: null, targetNodeID: priv.id });
        const body = await res.json() as { violations ?: { code : string }[] };

        expect(res.status).toBe(403);
        expect(body.violations?.some((violation) => violation.code === 'link.noAccess')).toBe(true);
    });

    it('refuses a link that targets another link with 422', async () =>
    {
        const folder = await makeFolder(owner, 'link-to-link-base');
        const firstLink = await (await owner.post('/api/nodes', {
            type: 'link',
            parentID: null,
            targetNodeID: folder.id,
        })).json() as NodeResponse;

        const res = await owner.post('/api/nodes', { type: 'link', parentID: null, targetNodeID: firstLink.id });
        const body = await res.json() as { violations ?: { code : string }[] };

        expect(res.status).toBe(422);
        expect(body.violations?.some((violation) => violation.code === 'link.targetIsLink')).toBe(true);
    });

    it('allows a self-link onto a node you own with 201', async () =>
    {
        const folder = await makeFolder(owner, 'self-link-base');

        const res = await owner.post('/api/nodes', { type: 'link', parentID: null, targetNodeID: folder.id });
        const link = await res.json() as NodeResponse;

        expect(res.status).toBe(201);
        expect(link.type).toBe('link');
        if(link.type !== 'link') { throw new Error('expected a link node'); }
        expect(link.targetNodeID).toBe(folder.id);
    });
});

//----------------------------------------------------------------------------------------------------------------------
