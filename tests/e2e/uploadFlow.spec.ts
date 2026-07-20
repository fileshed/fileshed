//----------------------------------------------------------------------------------------------------------------------
// E2E — Upload, proof-of-possession dedup, and quota
//
// The claim/PoP/upload story driven over real sockets and asserted against real state: user
// A claims an unknown blob, gets a ticket, and PUTs the bytes; the database shows the blob pinned to the default fs
// backend and A's file node under a folder A owns; the sharded store holds bytes that hash back to the claimed sha; A's
// quota grows by the logical size. Then user B claims the same (now known, >1 MiB) blob, is challenged, computes the
// HMAC proof from the local bytes, and dedups: one blob row, two file nodes, and -- dedup being invisible to quotas
// -- both owners charged the full size.
//----------------------------------------------------------------------------------------------------------------------

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { ClaimResponse, MeResponse, NodeListResponse, NodeResponse } from '@fileshed/core';

// Support
import {
    ApiClient,
    type ServerHandle,
    blobFileExists,
    computeAnswer,
    largeFixture,
    readBlobFile,
    sha256Of,
    spawnServer,
    withDb,
} from './support.ts';

//----------------------------------------------------------------------------------------------------------------------

const PASSWORD = 'correct-horse-battery';

let server : ServerHandle;

let alice : ApiClient;
let bob : ApiClient;
let aliceID : string;
let bobID : string;
let folderID : string;

const data = largeFixture();
const sha = sha256Of(data);

let claimIssuedTicket : boolean;
let putStatus : number;
let fileNode : NodeResponse;

async function callerID(client : ApiClient) : Promise<string>
{
    const me = await (await client.get('/api/me')).json() as MeResponse;
    return me.id;
}

//----------------------------------------------------------------------------------------------------------------------

beforeAll(async () =>
{
    server = await spawnServer();

    alice = new ApiClient(server.baseURL);
    await alice.signUp('alice@example.com', PASSWORD);
    aliceID = await callerID(alice);

    const folder = await (await alice.post('/api/nodes', { type: 'folder', name: 'uploads', parentID: null }))
        .json() as NodeResponse;
    folderID = folder.id;

    const claim = await (await alice.post('/api/blobs/claim', { sha256: sha, size: data.length }))
        .json() as ClaimResponse;
    claimIssuedTicket = claim.upload;
    if(claim.upload !== true) { throw new Error('setup: expected an upload ticket for an unknown blob'); }

    const query = new URLSearchParams({
        name: 'fixture.bin',
        parentID: folderID,
        mimeType: 'application/octet-stream',
    });
    const put = await alice.put(`/api/uploads/${ claim.ticket }?${ query.toString() }`, data);
    putStatus = put.status;
    fileNode = await put.json() as NodeResponse;

    bob = new ApiClient(server.baseURL);
    await bob.signUp('bob@example.com', PASSWORD);
    bobID = await callerID(bob);
});

afterAll(async () =>
{
    await server?.stop();
});

//----------------------------------------------------------------------------------------------------------------------
// A fresh upload (unknown blob)
//----------------------------------------------------------------------------------------------------------------------

describe('fresh upload by the first owner', () =>
{
    it('issues an upload ticket for the unknown blob and commits the owner file node on PUT', () =>
    {
        expect(claimIssuedTicket).toBe(true);
        expect(putStatus).toBe(200);

        expect(fileNode.type).toBe('file');
        if(fileNode.type !== 'file') { throw new Error('expected a file node'); }

        expect(fileNode.ownerID).toBe(aliceID);
        expect(fileNode.parentID).toBe(folderID);
        expect(fileNode.name).toBe('fixture.bin');
        expect(fileNode.size).toBe(data.length);
        expect(fileNode.blobID).toBe(sha);
        expect(fileNode.role).toBe('owner');
    });

    it('records the blob pinned to the default fs backend at the claimed size', async () =>
    {
        const blob = await withDb(server, (db) => db
            .selectFrom('blob')
            .selectAll()
            .where('sha256', '=', sha)
            .executeTakeFirst());

        const backend = await withDb(server, (db) => db
            .selectFrom('storage_backend')
            .select('id')
            .where('kind', '=', 'fs')
            .executeTakeFirstOrThrow());

        expect(blob).toBeDefined();
        expect(blob?.size).toBe(data.length);
        expect(blob?.storage_key).toBe(sha);
        expect(blob?.backend_id).toBe(backend.id);
        expect(blob?.deleted_at).toBeNull();
    });

    it('owns exactly one file node and surfaces it in the folder listing with the owner role', async () =>
    {
        const owners = await withDb(server, (db) => db
            .selectFrom('node')
            .select('owner_id')
            .where('blob_id', '=', sha)
            .where('type', '=', 'file')
            .execute());
        expect(owners.map((row) => row.owner_id)).toEqual([ aliceID ]);

        const listing = await (await alice.get(`/api/nodes/${ folderID }/children`)).json() as NodeListResponse;
        const child = listing.nodes.find((node) => node.id === fileNode.id);

        expect(child?.type).toBe('file');
        if(child?.type !== 'file') { throw new Error('expected the uploaded file in the folder listing'); }
        expect(child.name).toBe('fixture.bin');
        expect(child.size).toBe(data.length);
        expect(child.role).toBe('owner');
    });

    it('lands the exact bytes in the sharded blob store', async () =>
    {
        expect(await blobFileExists(server.storageRoot, sha)).toBe(true);

        const stored = await readBlobFile(server.storageRoot, sha);
        expect(sha256Of(stored)).toBe(sha);
        expect(stored.equals(data)).toBe(true);
    });

    it('charges the uploader quota for the logical size', async () =>
    {
        const me = await (await alice.get('/api/me')).json() as MeResponse;

        expect(me.quota.used).toBe(data.length);
    });
});

//----------------------------------------------------------------------------------------------------------------------
// Proof-of-possession dedup (known blob; quota invisible to dedup)
//----------------------------------------------------------------------------------------------------------------------

describe('proof-of-possession dedup by a second owner', () =>
{
    it('challenges the second claimant, dedups on a correct proof, and charges both owners', async () =>
    {
        const challenge = await (await bob.post('/api/blobs/claim', { sha256: sha, size: data.length }))
            .json() as ClaimResponse;

        expect(challenge.upload).toBe(false);
        if(challenge.upload !== false) { throw new Error('expected a proof-of-possession challenge'); }

        // Structural assertion for randomized output: 2-4 ranges, each in-bounds. Never assert exact offsets/lengths --
        // fixed ranges would be harvest-and-replay-able, the exact property the challenge exists to defeat.
        expect(challenge.challengeID.length).toBeGreaterThan(0);
        expect(challenge.nonce.length).toBeGreaterThan(0);
        expect(challenge.ranges.length).toBeGreaterThanOrEqual(2);
        expect(challenge.ranges.length).toBeLessThanOrEqual(4);
        for(const [ offset, length ] of challenge.ranges)
        {
            expect(offset).toBeGreaterThanOrEqual(0);
            expect(length).toBeGreaterThanOrEqual(1);
            expect(offset + length).toBeLessThanOrEqual(data.length);
        }

        const answer = computeAnswer(challenge.nonce, challenge.ranges, data);
        const res = await bob.post(`/api/blobs/claim/${ challenge.challengeID }`, {
            answer,
            name: 'fixture-copy.bin',
            parentID: null,
            mimeType: 'application/octet-stream',
        });
        const node = await res.json() as NodeResponse;

        expect(res.status).toBe(200);
        expect(node.type).toBe('file');
        if(node.type !== 'file') { throw new Error('expected a file node'); }
        expect(node.ownerID).toBe(bobID);
        expect(node.blobID).toBe(sha);
        expect(node.role).toBe('owner');

        // One blob row, now referenced by two file nodes -- the dedup: zero bytes moved for B's copy.
        const blobRows = await withDb(server, (db) => db
            .selectFrom('blob')
            .select('sha256')
            .where('sha256', '=', sha)
            .execute());
        expect(blobRows).toHaveLength(1);

        const owners = await withDb(server, (db) => db
            .selectFrom('node')
            .select('owner_id')
            .where('blob_id', '=', sha)
            .where('type', '=', 'file')
            .execute());
        expect(owners.map((row) => row.owner_id).sort()).toEqual([ aliceID, bobID ].sort());

        // Dedup is invisible to quotas: each owner is charged the full logical size.
        const aliceUsed = (await (await alice.get('/api/me')).json() as MeResponse).quota.used;
        const bobUsed = (await (await bob.get('/api/me')).json() as MeResponse).quota.used;
        expect(aliceUsed).toBe(data.length);
        expect(bobUsed).toBe(data.length);
    });
});

//----------------------------------------------------------------------------------------------------------------------
