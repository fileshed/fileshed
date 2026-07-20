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
