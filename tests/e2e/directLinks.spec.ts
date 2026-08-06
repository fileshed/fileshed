//----------------------------------------------------------------------------------------------------------------------
// E2E — Direct links and authed downloads
//
// The direct-link surface over real sockets. An owner mints two public links on one file and the database holds two
// public_link rows with distinct, >=128-bit tokens. Anonymous fetches of /d/:token (no cookies, the token is the whole
// capability) serve 200 with the right Content-Type and bytes that hash back to the fixture, rendered in place until
// the URL says ?download; a Range yields 206 with exactly those bytes and a Content-Range; a matching If-None-Match
// yields 304. Revoking a link 404s its token permanently -- in both forms, since both are the one token -- while the
// other still serves; trashing the file kills the live link, and restoring heals it (a revoked link stays dead --
// revocation is permanent, trash is transient). Finally the authed /api/nodes/:id/download ladder: owner 200, a
// granted viewer 200 (the share-aware resolver over real HTTP), a stranger 404, anonymous 401.
//----------------------------------------------------------------------------------------------------------------------

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { ClaimResponse, NodeResponse, PublicLinkListResponse, PublicLinkResponse } from '@fileshed/core';

// Support
import { ApiClient, type ServerHandle, largeFixture, readBlobFile, sha256Of, spawnServer, withDb } from './support.ts';

//----------------------------------------------------------------------------------------------------------------------

const PASSWORD = 'correct-horse-battery';
const MIME = 'image/png';

const data = largeFixture('direct-file');
const sha = sha256Of(data);
const etag = `"${ sha }"`;

let server : ServerHandle;

let owner : ApiClient;
let viewer : ApiClient;
let stranger : ApiClient;
let viewerID : string;

let fileID : string;
let link : PublicLinkResponse;
let spare : PublicLinkResponse;
let createStatus : number;

async function callerID(client : ApiClient) : Promise<string>
{
    const me = await (await client.get('/api/me')).json() as { id : string };
    return me.id;
}

// A cookieless GET of the anonymous direct-link surface -- raw fetch, no jar, no Origin: the token is the capability.
function direct(token : string, headers : Record<string, string> = {}, query = '') : Promise<Response>
{
    return fetch(`${ server.baseURL }/d/${ token }${ query }`, { headers });
}

// Status only, draining the body so the socket frees between calls.
async function directStatus(token : string, headers : Record<string, string> = {}, query = '') : Promise<number>
{
    const res = await direct(token, headers, query);
    await res.arrayBuffer();
    return res.status;
}

async function downloadStatus(client : ApiClient) : Promise<number>
{
    const res = await client.get(`/api/nodes/${ fileID }/download`);
    await res.arrayBuffer();
    return res.status;
}

async function upload(client : ApiClient, name : string, bytes : Buffer, mimeType : string) : Promise<NodeResponse>
{
    const claim = await (await client.post('/api/blobs/claim', { sha256: sha256Of(bytes), size: bytes.length }))
        .json() as ClaimResponse;
    if(claim.upload !== true) { throw new Error('expected an upload ticket'); }

    const params = new URLSearchParams({ name, mimeType });

    return await (await client.put(`/api/uploads/${ claim.ticket }?${ params.toString() }`, bytes))
        .json() as NodeResponse;
}

//----------------------------------------------------------------------------------------------------------------------

beforeAll(async () =>
{
    server = await spawnServer();

    owner = new ApiClient(server.baseURL);
    viewer = new ApiClient(server.baseURL);
    stranger = new ApiClient(server.baseURL);
    await owner.signUp('linker@example.com', PASSWORD);
    await viewer.signUp('viewer@example.com', PASSWORD);
    await stranger.signUp('stranger@example.com', PASSWORD);
    viewerID = await callerID(viewer);

    fileID = (await upload(owner, 'poster.png', data, MIME)).id;

    const createRes = await owner.post(`/api/nodes/${ fileID }/links`);
    createStatus = createRes.status;
    link = await createRes.json() as PublicLinkResponse;

    spare = await (await owner.post(`/api/nodes/${ fileID }/links`)).json() as PublicLinkResponse;
});

afterAll(async () =>
{
    await server?.stop();
});

//----------------------------------------------------------------------------------------------------------------------
// Link creation
//----------------------------------------------------------------------------------------------------------------------

describe('link creation', () =>
{
    it('mints a link from a POST with no body, answering with the token and its URL', () =>
    {
        expect(createStatus).toBe(201);
        expect(link.nodeID).toBe(fileID);
        expect(link.url).toBe(`/d/${ link.token }`);
        expect(link.revokedAt).toBeNull();
    });

    it('records two public_link rows with distinct, >=128-bit tokens', async () =>
    {
        const rows = await withDb(server, (db) => db
            .selectFrom('public_link')
            .select([ 'id', 'token' ])
            .where('node_id', '=', fileID)
            .execute());

        expect(rows).toHaveLength(2);
        const tokens = rows.map((row) => row.token);
        expect(new Set(tokens).size).toBe(2);
        for(const token of tokens)
        {
            // base64url of >=16 raw bytes carries >=128 bits of entropy.
            expect(Buffer.from(token, 'base64url').length).toBeGreaterThanOrEqual(16);
        }
    });
});

//----------------------------------------------------------------------------------------------------------------------
// Anonymous byte serving
//----------------------------------------------------------------------------------------------------------------------

describe('anonymous /d/:token', () =>
{
    it('renders the file in place and streams the bytes held in the blob store', async () =>
    {
        const res = await direct(link.token);
        const bytes = Buffer.from(await res.arrayBuffer());

        expect(res.status).toBe(200);
        expect(res.headers.get('content-type')).toBe(MIME);
        expect(res.headers.get('content-disposition') ?? '').toMatch(/^inline/);
        expect(res.headers.get('accept-ranges')).toBe('bytes');
        expect(res.headers.get('etag')).toBe(etag);
        expect(sha256Of(bytes)).toBe(sha);

        // The served body is byte-identical to what the fs backend actually holds at its sharded path -- the link
        // streams the stored blob, not something reassembled along the way.
        expect(bytes.equals(await readBlobFile(server.storageRoot, sha))).toBe(true);
    });

    it('saves the same token under ?download, filename and all', async () =>
    {
        const res = await direct(link.token, {}, '?download');
        const bytes = Buffer.from(await res.arrayBuffer());

        expect(res.status).toBe(200);
        expect(res.headers.get('content-disposition') ?? '').toBe('attachment; filename="poster.png"');
        expect(sha256Of(bytes)).toBe(sha);
    });

    it('honors a byte range with 206 and exactly the requested bytes', async () =>
    {
        const res = await direct(link.token, { range: 'bytes=100-199' });
        const bytes = Buffer.from(await res.arrayBuffer());

        expect(res.status).toBe(206);
        expect(res.headers.get('content-range')).toBe(`bytes 100-199/${ data.length }`);
        expect(res.headers.get('content-length')).toBe('100');
        expect(bytes.length).toBe(100);
        expect(bytes.equals(data.subarray(100, 200))).toBe(true);
    });

    it('answers a matching If-None-Match with a bodiless 304', async () =>
    {
        const res = await direct(link.token, { 'if-none-match': etag });
        await res.arrayBuffer();

        expect(res.status).toBe(304);
    });

    it('answers an unsatisfiable range with 416 and a Content-Range of the full size', async () =>
    {
        // first-byte-pos at the blob size is past the last byte -- a valid but unsatisfiable range.
        const res = await direct(link.token, { range: `bytes=${ data.length }-` });
        await res.arrayBuffer();

        expect(res.status).toBe(416);
        expect(res.headers.get('content-range')).toBe(`bytes */${ data.length }`);
        expect(res.headers.get('accept-ranges')).toBe('bytes');
    });
});

//----------------------------------------------------------------------------------------------------------------------
// Revocation and trash healing
//----------------------------------------------------------------------------------------------------------------------

// One test, because these are the steps of a single state machine: each step's expected answer only means anything
// against the state the previous step left. Splitting them would make every one of them depend on the last having run.
describe('revocation and trash', () =>
{
    it('kills a revoked link permanently and a trashed one only until restore', async () =>
    {
        // Revoking one link leaves the other serving -- multiple links per node, independently revocable.
        expect((await owner.del(`/api/links/${ spare.id }`)).status).toBe(204);
        expect(await directStatus(spare.token)).toBe(404);
        // Both forms of the revoked token are dead, because both forms are the one token.
        expect(await directStatus(spare.token, {}, '?download')).toBe(404);
        expect(await directStatus(link.token)).toBe(200);

        // Trashing the file takes the still-live link down with it -- trashed nodes are hidden from everyone.
        expect((await owner.post(`/api/nodes/${ fileID }/trash`, {})).status).toBe(200);
        expect(await directStatus(link.token)).toBe(404);
        expect(await directStatus(link.token, {}, '?download')).toBe(404);

        // Restoring heals the trashed link -- trash death is transient...
        expect((await owner.post(`/api/nodes/${ fileID }/restore`, {})).status).toBe(200);
        expect(await directStatus(link.token)).toBe(200);
        // ...but revocation is not.
        expect(await directStatus(spare.token)).toBe(404);
    });
});

//----------------------------------------------------------------------------------------------------------------------
// Authed download ladder
//----------------------------------------------------------------------------------------------------------------------

describe('GET /api/nodes/:id/download', () =>
{
    it('serves the owner, a granted viewer, refuses a stranger (404) and anonymous (401)', async () =>
    {
        await owner.post(`/api/nodes/${ fileID }/shares`, { granteeUserID: viewerID, role: 'viewer' });

        expect(await downloadStatus(owner)).toBe(200);
        // The download authorization is the share-aware resolver, so a viewer downloads.
        expect(await downloadStatus(viewer)).toBe(200);
        // No access reads as absent, never confirming the file exists.
        expect(await downloadStatus(stranger)).toBe(404);

        const anon = await fetch(`${ server.baseURL }/api/nodes/${ fileID }/download`);
        await anon.arrayBuffer();
        expect(anon.status).toBe(401);
    });
});

//----------------------------------------------------------------------------------------------------------------------
// Link management authority
//----------------------------------------------------------------------------------------------------------------------

describe('GET /api/nodes/:id/links', () =>
{
    it('lists a file\'s links to its owner and refuses a non-owner minting one with 403', async () =>
    {
        const res = await owner.get(`/api/nodes/${ fileID }/links`);
        const list = await res.json() as PublicLinkListResponse;

        expect(res.status).toBe(200);
        // Both minted links list for the owner (a revoked link still lists so the owner sees it is dead).
        const ids = list.links.map((entry) => entry.id);
        expect(ids).toContain(link.id);
        expect(ids).toContain(spare.id);

        // Minting a link is the owner's authority; a stranger cannot publish content they do not own.
        const strangerMint = await stranger.post(`/api/nodes/${ fileID }/links`);
        expect(strangerMint.status).toBe(403);
    });
});

//----------------------------------------------------------------------------------------------------------------------
