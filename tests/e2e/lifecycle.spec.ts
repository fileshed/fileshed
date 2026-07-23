//----------------------------------------------------------------------------------------------------------------------
// E2E — Node lifecycle: trash, restore, hard delete, and the lying-sha rejection
//
// The trash/delete semantics walked end to end over real sockets, with the database and the blob store inspected at
// each step: a file uploaded into a folder is trashed (hidden from the listing but still charged), restored (back in
// the listing), then hard-deleted -- its node row gone and its now-unreferenced blob graveyarded (deleted_at set) with
// the bytes still on disk pending GC. A separate lying-sha upload proves the store rejects mismatched bytes and leaves
// nothing behind: no blob row, no node, no file, no staging orphan.
//----------------------------------------------------------------------------------------------------------------------

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { ClaimResponse, MeResponse, NodeListResponse, NodeResponse } from '@fileshed/core';

// Support
import {
    ApiClient,
    type ServerHandle,
    blobFileExists,
    sha256Of,
    smallFixture,
    spawnServer,
    stagedFiles,
    withDb,
} from './support.ts';

//----------------------------------------------------------------------------------------------------------------------

const PASSWORD = 'correct-horse-battery';

const data = smallFixture('lifecycle-file');
const sha = sha256Of(data);

let server : ServerHandle;
let user : ApiClient;
let userID : string;
let folderID : string;
let fileNodeID : string;
let folderCreateStatus : number;
let putStatus : number;
let uploadedNode : NodeResponse;

async function childIDs(parentID : string) : Promise<string[]>
{
    const listing = await (await user.get(`/api/nodes/${ parentID }/children`)).json() as NodeListResponse;
    return listing.nodes.map((node) => node.id);
}

async function quotaUsed() : Promise<number>
{
    const me = await (await user.get('/api/me')).json() as MeResponse;
    return me.quota.used;
}

//----------------------------------------------------------------------------------------------------------------------

beforeAll(async () =>
{
    server = await spawnServer();

    user = new ApiClient(server.baseURL);
    await user.signUp('curator@example.com', PASSWORD);
    userID = (await (await user.get('/api/me')).json() as MeResponse).id;

    const folderRes = await user.post('/api/nodes', { type: 'folder', name: 'project', parentID: null });
    folderCreateStatus = folderRes.status;
    folderID = (await folderRes.json() as NodeResponse).id;

    const claim = await (await user.post('/api/blobs/claim', { sha256: sha, size: data.length }))
        .json() as ClaimResponse;
    if(claim.upload !== true) { throw new Error('setup: expected an upload ticket'); }

    const query = new URLSearchParams({ name: 'doc.bin', parentID: folderID, mimeType: 'application/octet-stream' });
    const put = await user.put(`/api/uploads/${ claim.ticket }?${ query.toString() }`, data);
    putStatus = put.status;
    uploadedNode = await put.json() as NodeResponse;
    fileNodeID = uploadedNode.id;
});

afterAll(async () =>
{
    await server?.stop();
});

//----------------------------------------------------------------------------------------------------------------------
// The trash lifecycle, walked in order on one file
//----------------------------------------------------------------------------------------------------------------------

describe('trash, restore, hard delete', () =>
{
    it('creates the folder and places the uploaded file inside it', () =>
    {
        expect(folderCreateStatus).toBe(201);
        expect(putStatus).toBe(200);

        expect(uploadedNode.type).toBe('file');
        if(uploadedNode.type !== 'file') { throw new Error('expected a file node'); }
        expect(uploadedNode.ownerID).toBe(userID);
        expect(uploadedNode.parentID).toBe(folderID);
    });

    it('hides a trashed file from the folder listing while still charging its quota', async () =>
    {
        const res = await user.post(`/api/nodes/${ fileNodeID }/trash`, {});
        expect(res.status).toBe(200);

        // Trashed items drop out of the normal listing...
        expect(await childIDs(folderID)).not.toContain(fileNodeID);

        // ...but a trashed file still counts against the owner's quota -- trash is not free storage.
        expect(await quotaUsed()).toBe(data.length);
    });

    it('restores the trashed file back into its folder', async () =>
    {
        const res = await user.post(`/api/nodes/${ fileNodeID }/restore`, {});
        expect(res.status).toBe(200);

        expect(await childIDs(folderID)).toContain(fileNodeID);
    });

    it('hard-deletes the file: node row gone, blob graveyarded, bytes pending GC, quota released', async () =>
    {
        const res = await user.del(`/api/nodes/${ fileNodeID }`);
        expect(res.status).toBe(204);

        const node = await withDb(server, (db) => db
            .selectFrom('node')
            .select('id')
            .where('id', '=', fileNodeID)
            .executeTakeFirst());
        expect(node).toBeUndefined();

        // Last reference gone -> the blob is graveyarded (deleted_at set), not yet purged: the bytes survive the grace
        // window for possible resurrection, and GC removes them later.
        const blob = await withDb(server, (db) => db
            .selectFrom('blob')
            .select([ 'sha256', 'deleted_at' ])
            .where('sha256', '=', sha)
            .executeTakeFirst());
        expect(blob).toBeDefined();
        expect(blob?.deleted_at).not.toBeNull();
        expect(await blobFileExists(server.storageRoot, sha)).toBe(true);

        expect(await quotaUsed()).toBe(0);
    });
});

//----------------------------------------------------------------------------------------------------------------------
// A lying client cannot poison the store
//----------------------------------------------------------------------------------------------------------------------

describe('lying-sha upload', () =>
{
    it('rejects bytes that do not match the claimed hash and stores nothing', async () =>
    {
        const honest = smallFixture('lie-honest');
        const forged = smallFixture('lie-forged');
        const honestSha = sha256Of(honest);

        const claim = await (await user.post('/api/blobs/claim', { sha256: honestSha, size: honest.length }))
            .json() as ClaimResponse;
        if(claim.upload !== true) { throw new Error('expected an upload ticket'); }

        const query = new URLSearchParams({
            name: 'liar.bin',
            parentID: folderID,
            mimeType: 'application/octet-stream',
        });
        const put = await user.put(`/api/uploads/${ claim.ticket }?${ query.toString() }`, forged);
        expect(put.status).toBe(400);

        // No blob record, and no node references the claimed hash.
        const blob = await withDb(server, (db) => db
            .selectFrom('blob')
            .select('sha256')
            .where('sha256', '=', honestSha)
            .executeTakeFirst());
        expect(blob).toBeUndefined();

        const nodes = await withDb(server, (db) => db
            .selectFrom('node')
            .select('id')
            .where('blob_id', '=', honestSha)
            .execute());
        expect(nodes).toHaveLength(0);

        // No committed file and no orphaned staging bytes -- the store cleans its staging file on a rejected put.
        expect(await blobFileExists(server.storageRoot, honestSha)).toBe(false);
        expect(await stagedFiles(server.storageRoot)).toHaveLength(0);
    });
});

//----------------------------------------------------------------------------------------------------------------------
// Shared helpers for the multi-user lifecycle scenarios below
//----------------------------------------------------------------------------------------------------------------------

async function idOf(client : ApiClient) : Promise<string>
{
    return (await (await client.get('/api/me')).json() as MeResponse).id;
}

async function uploadInto(
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

//----------------------------------------------------------------------------------------------------------------------
// Trashing a shared folder hides it from recipients (owner exempt)
//
// The owner trashing a shared folder hides its whole subtree from recipients: its contents drop out of their listing,
// it leaves their Shared with me, and its files' bytes stop serving them -- while the owner keeps access to their own
// trash until it purges.
//----------------------------------------------------------------------------------------------------------------------

describe('trashing a shared folder', () =>
{
    let owner : ApiClient;
    let recipient : ApiClient;
    let sharedFolderID : string;
    let sharedChildID : string;

    beforeAll(async () =>
    {
        owner = new ApiClient(server.baseURL);
        recipient = new ApiClient(server.baseURL);
        await owner.signUp('trash-owner@example.com', PASSWORD);
        await recipient.signUp('trash-recipient@example.com', PASSWORD);
        const recipientID = await idOf(recipient);

        sharedFolderID = (await (await owner.post('/api/nodes', { type: 'folder', name: 'shared', parentID: null }))
            .json() as NodeResponse).id;
        sharedChildID = (await uploadInto(owner, sharedFolderID, 'inside.bin', smallFixture('trash-shared-child'))).id;
        await owner.post(`/api/nodes/${ sharedFolderID }/shares`, { granteeUserID: recipientID, role: 'viewer' });
    });

    it('cuts the recipient off from the contents and the child bytes, exempting the owner', async () =>
    {
        // The recipient reads the shared folder before it is trashed.
        const before = await recipient.get(`/api/nodes/${ sharedFolderID }/children`);
        expect(before.status).toBe(200);
        expect((await before.json() as NodeListResponse).nodes.map((node) => node.id)).toContain(sharedChildID);

        // The owner trashes the shared folder; setTrashed stamps the whole subtree.
        expect((await owner.post(`/api/nodes/${ sharedFolderID }/trash`, {})).status).toBe(200);

        // The trashed folder reads as absent to the recipient -- the listing and the direct read both 404 rather
        // than confirming the folder still exists -- and it leaves their Shared with me.
        const listing = await recipient.get(`/api/nodes/${ sharedFolderID }/children`);
        await listing.arrayBuffer();
        expect(listing.status).toBe(404);

        const direct = await recipient.get(`/api/nodes/${ sharedFolderID }`);
        await direct.arrayBuffer();
        expect(direct.status).toBe(404);

        const swm = await (await recipient.get('/api/shared-with-me'))
            .json() as { entries : { share : { nodeID : string } }[] };
        expect(swm.entries.some((entry) => entry.share.nodeID === sharedFolderID)).toBe(false);

        // A recipient cannot pull the trashed child's bytes...
        const recipientDownload = await recipient.get(`/api/nodes/${ sharedChildID }/download`);
        await recipientDownload.arrayBuffer();
        expect(recipientDownload.status).toBe(404);

        // ...but the owner keeps their own trash until it purges.
        const ownerDownload = await owner.get(`/api/nodes/${ sharedChildID }/download`);
        await ownerDownload.arrayBuffer();
        expect(ownerDownload.status).toBe(200);
    });
});

//----------------------------------------------------------------------------------------------------------------------
// Restore to root when the original parent is gone
//----------------------------------------------------------------------------------------------------------------------

describe('restore to root', () =>
{
    it('lands a restored file at the root when its original parent is trashed', async () =>
    {
        const folder = await (await user.post('/api/nodes', { type: 'folder', name: 'restore-parent', parentID: null }))
            .json() as NodeResponse;
        const file = await uploadInto(user, folder.id, 'restore-me.bin', smallFixture('restore-root-file'));

        // Trash the file, then its parent folder -- the parent has no live place to return to.
        expect((await user.post(`/api/nodes/${ file.id }/trash`, {})).status).toBe(200);
        expect((await user.post(`/api/nodes/${ folder.id }/trash`, {})).status).toBe(200);

        const restore = await user.post(`/api/nodes/${ file.id }/restore`, {});
        const restored = await restore.json() as NodeResponse;

        expect(restore.status).toBe(200);
        expect(restored.parentID).toBeNull();
        if(restored.type !== 'file') { throw new Error('expected a file node'); }
        expect(restored.trashedAt).toBeNull();

        // It reappears in the caller's root listing, no longer under the trashed folder.
        const root = await (await user.get('/api/nodes/children')).json() as NodeListResponse;
        expect(root.nodes.map((node) => node.id)).toContain(file.id);
    });
});

//----------------------------------------------------------------------------------------------------------------------
// Trash listing: GET /api/trash over the wire
//
// The Trash view walked end to end: a trashed folder lists as a root, a trashed CHILD of a trashed folder does not
// double-list, restoring drops the node from the listing, and one user's trash is invisible to another.
//----------------------------------------------------------------------------------------------------------------------

describe('trash listing over the wire', () =>
{
    async function trashIDs(client : ApiClient) : Promise<string[]>
    {
        const listing = await (await client.get('/api/trash')).json() as NodeListResponse;
        return listing.nodes.map((node) => node.id);
    }

    it('lists trashed roots, hides nested trashed children, and clears on restore -- per caller', async () =>
    {
        const owner = new ApiClient(server.baseURL);
        const other = new ApiClient(server.baseURL);
        await owner.signUp('trash-list-owner@example.com', PASSWORD);
        await other.signUp('trash-list-other@example.com', PASSWORD);

        const parent = (await (await owner.post('/api/nodes', { type: 'folder', name: 'roots', parentID: null }))
            .json() as NodeResponse).id;
        const child = (await (await owner.post('/api/nodes', { type: 'folder', name: 'nested', parentID: parent }))
            .json() as NodeResponse).id;
        const solo = (await (await owner.post('/api/nodes', { type: 'folder', name: 'solo', parentID: null }))
            .json() as NodeResponse).id;

        // Trash the parent (stamping its child too) and the standalone folder.
        expect((await owner.post(`/api/nodes/${ parent }/trash`, {})).status).toBe(200);
        expect((await owner.post(`/api/nodes/${ solo }/trash`, {})).status).toBe(200);

        // Both trashed roots list; the nested child rides along with its parent and never lists on its own.
        const listed = await trashIDs(owner);
        expect(listed).toContain(parent);
        expect(listed).toContain(solo);
        expect(listed).not.toContain(child);

        // Another user sees none of it.
        expect(await trashIDs(other)).toHaveLength(0);

        // Restoring the parent drops it from the trash listing; the standalone folder stays.
        expect((await owner.post(`/api/nodes/${ parent }/restore`, {})).status).toBe(200);
        const afterRestore = await trashIDs(owner);
        expect(afterRestore).not.toContain(parent);
        expect(afterRestore).toContain(solo);
    });
});

//----------------------------------------------------------------------------------------------------------------------
// Empty trash: DELETE /api/trash over the wire
//
// Emptying the trash purges every one of the caller's own trashed roots in one call and reports how many were purged,
// leaving the listing empty; another user's trash is untouched.
//----------------------------------------------------------------------------------------------------------------------

describe('empty trash over the wire', () =>
{
    async function trashIDs(client : ApiClient) : Promise<string[]>
    {
        const listing = await (await client.get('/api/trash')).json() as NodeListResponse;
        return listing.nodes.map((node) => node.id);
    }

    it('purges every trashed root and reports the count, leaving another user\'s trash intact', async () =>
    {
        const owner = new ApiClient(server.baseURL);
        const other = new ApiClient(server.baseURL);
        await owner.signUp('empty-trash-owner@example.com', PASSWORD);
        await other.signUp('empty-trash-other@example.com', PASSWORD);

        const first = (await (await owner.post('/api/nodes', { type: 'folder', name: 'first', parentID: null }))
            .json() as NodeResponse).id;
        const second = (await (await owner.post('/api/nodes', { type: 'folder', name: 'second', parentID: null }))
            .json() as NodeResponse).id;
        const untouched = (await (await other.post('/api/nodes', { type: 'folder', name: 'mine', parentID: null }))
            .json() as NodeResponse).id;

        expect((await owner.post(`/api/nodes/${ first }/trash`, {})).status).toBe(200);
        expect((await owner.post(`/api/nodes/${ second }/trash`, {})).status).toBe(200);
        expect((await other.post(`/api/nodes/${ untouched }/trash`, {})).status).toBe(200);

        const emptied = await owner.del('/api/trash');

        expect(emptied.status).toBe(200);
        expect(await emptied.json()).toEqual({ purged: 2 });
        expect(await trashIDs(owner)).toEqual([]);
        expect(await trashIDs(other)).toEqual([ untouched ]);
    });
});

//----------------------------------------------------------------------------------------------------------------------
// Deletion offers: recipients-may-copy on hard delete
//
// Hard-deleting a shared file with the recipients-may-copy opt-in graveyards the blob but keeps its bytes for the grace
// window and mints an offer per recipient. Accepting resurrects the blob into a fresh node the accepter owns, and
// consumes the offer.
//----------------------------------------------------------------------------------------------------------------------

describe('deletion offers over the wire', () =>
{
    it('offers a copy on delete; accepting resurrects the blob into an owned node', async () =>
    {
        const owner = new ApiClient(server.baseURL);
        const recipient = new ApiClient(server.baseURL);
        await owner.signUp('offer-owner@example.com', PASSWORD);
        await recipient.signUp('offer-recipient@example.com', PASSWORD);
        const recipientID = await idOf(recipient);

        const bytes = smallFixture('deletion-offer-file');
        const offerSha = sha256Of(bytes);
        const file = await uploadInto(owner, null, 'shared-file.bin', bytes);
        await owner.post(`/api/nodes/${ file.id }/shares`, { granteeUserID: recipientID, role: 'viewer' });

        // Delete, opting to let current recipients save a copy.
        expect((await owner.del(`/api/nodes/${ file.id }?offerCopies=true`)).status).toBe(204);

        // Last reference gone: the blob is graveyarded, but its bytes ride the grace window on disk.
        const graveyarded = await withDb(server, (db) => db
            .selectFrom('blob')
            .select('deleted_at')
            .where('sha256', '=', offerSha)
            .executeTakeFirstOrThrow());
        expect(graveyarded.deleted_at).not.toBeNull();
        expect(await blobFileExists(server.storageRoot, offerSha)).toBe(true);

        // The recipient sees the offer and accepts it.
        const listed = await (await recipient.get('/api/deletion-offers'))
            .json() as { offers : { id : string; sha256 : string }[] };
        const offer = listed.offers.find((candidate) => candidate.sha256 === offerSha);
        expect(offer).toBeDefined();
        if(offer === undefined) { throw new Error('expected a deletion offer for the recipient'); }

        const accept = await recipient.post(`/api/deletion-offers/${ offer.id }/accept`, { parentID: null });
        const copy = await accept.json() as NodeResponse;

        expect(accept.status).toBe(201);
        expect(copy.type).toBe('file');
        if(copy.type !== 'file') { throw new Error('expected a file node'); }
        expect(copy.ownerID).toBe(recipientID);
        expect(copy.blobID).toBe(offerSha);

        // Accepting cleared the graveyard marker (resurrection), bytes still in place.
        const resurrected = await withDb(server, (db) => db
            .selectFrom('blob')
            .select('deleted_at')
            .where('sha256', '=', offerSha)
            .executeTakeFirstOrThrow());
        expect(resurrected.deleted_at).toBeNull();
        expect(await blobFileExists(server.storageRoot, offerSha)).toBe(true);

        // The offer is consumed -- it no longer lists.
        const remaining = await (await recipient.get('/api/deletion-offers'))
            .json() as { offers : { id : string }[] };
        expect(remaining.offers.some((candidate) => candidate.id === offer.id)).toBe(false);
    });
});

//----------------------------------------------------------------------------------------------------------------------
