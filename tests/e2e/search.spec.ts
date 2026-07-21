//----------------------------------------------------------------------------------------------------------------------
// E2E — Name search scoped to accessible nodes
//
// GET /api/search over real sockets. Search is a case-insensitive substring match on a node's name, scoped to what the
// caller can actually reach: a caller finds their own file, a stranger searching the same term finds nothing, and a
// shared-in file surfaces for the recipient carrying the role the share granted. Trashed nodes drop out, a blank query
// is a 400 rather than a match-everything scan, and every hit rides in the ordinary paginated node envelope with the
// standard node-response shape. Each test searches a term unique to the nodes it seeds, so the shared server's
// accumulating tree never leaks one test's files into another's results.
//----------------------------------------------------------------------------------------------------------------------

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { ClaimResponse, MeResponse, NodeListResponse, NodeResponse } from '@fileshed/core';

// Support
import { ApiClient, type ServerHandle, sha256Of, smallFixture, spawnServer } from './support.ts';

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

function search(client : ApiClient, term : string) : Promise<Response>
{
    // eslint-disable-next-line id-length -- `q` is the wire query-string parameter name for GET /api/search
    const params = new URLSearchParams({ q: term });
    return client.get(`/api/search?${ params.toString() }`);
}

//----------------------------------------------------------------------------------------------------------------------

beforeAll(async () =>
{
    server = await spawnServer();

    owner = new ApiClient(server.baseURL);
    recipient = new ApiClient(server.baseURL);
    stranger = new ApiClient(server.baseURL);
    await owner.signUp('search-owner@example.com', PASSWORD);
    await recipient.signUp('search-recipient@example.com', PASSWORD);
    await stranger.signUp('search-stranger@example.com', PASSWORD);
    recipientID = await callerID(recipient);
});

afterAll(async () =>
{
    await server?.stop();
});

//----------------------------------------------------------------------------------------------------------------------
// Accessibility scope
//----------------------------------------------------------------------------------------------------------------------

describe('GET /api/search', () =>
{
    it('matches the caller\'s own file by case-insensitive substring, and hides it from a stranger', async () =>
    {
        const file = await upload(owner, null, 'Quarterly-Zephyr.pdf', smallFixture('search-zephyr'));

        const lower = await (await search(owner, 'zephyr')).json() as NodeListResponse;
        const upper = await (await search(owner, 'ZEPHYR')).json() as NodeListResponse;
        const outsider = await search(stranger, 'zephyr');
        const outsiderBody = await outsider.json() as NodeListResponse;

        // Both cases hit the one file; the term is unique to it, so the match set is exactly that node.
        expect(lower.nodes.map((node) => node.id)).toEqual([ file.id ]);
        expect(upper.nodes.map((node) => node.id)).toEqual([ file.id ]);
        expect(lower.total).toBe(1);

        // A user with no ownership and no grant resolves nothing under that term.
        expect(outsider.status).toBe(200);
        expect(outsiderBody.nodes).toHaveLength(0);
        expect(outsiderBody.total).toBe(0);
    });

    it('surfaces a shared-in file for the recipient with the granted role stamped', async () =>
    {
        const folder = await makeFolder(owner, 'search-shared-folder');
        const file = await upload(owner, folder.id, 'Griffin-budget.txt', smallFixture('search-griffin'));
        expect((await grantShare(folder.id, recipientID, 'editor')).status).toBe(201);

        const result = await (await search(recipient, 'griffin')).json() as NodeListResponse;

        const hit = result.nodes.find((node) => node.id === file.id);
        expect(hit).toBeDefined();
        // The folder's editor grant is inherited by the file, and search stamps that effective role on the hit.
        expect(hit?.role).toBe('editor');
    });

    it('excludes trashed files from the results', async () =>
    {
        const live = await upload(owner, null, 'Kestrel-live.txt', smallFixture('search-kestrel-live'));
        const gone = await upload(owner, null, 'Kestrel-gone.txt', smallFixture('search-kestrel-gone'));
        expect((await owner.post(`/api/nodes/${ gone.id }/trash`, {})).status).toBe(200);

        const result = await (await search(owner, 'kestrel')).json() as NodeListResponse;

        expect(result.nodes.map((node) => node.id)).toEqual([ live.id ]);
        expect(result.total).toBe(1);
    });

    it('rejects a blank or whitespace-only query with 400', async () =>
    {
        expect((await search(owner, '')).status).toBe(400);
        expect((await search(owner, '   ')).status).toBe(400);
    });

    it('returns each hit in the standard node-response shape within the paginated envelope', async () =>
    {
        const file = await upload(owner, null, 'Marlin-shape.txt', smallFixture('search-marlin'));

        const result = await (await search(owner, 'marlin')).json() as NodeListResponse;
        const hit = result.nodes.find((node) => node.id === file.id);

        expect(hit).toMatchObject({
            id: file.id,
            name: 'Marlin-shape.txt',
            type: 'file',
            ownerID: file.ownerID,
            role: 'owner',
        });
        expect(typeof hit?.createdAt).toBe('string');
        expect(typeof hit?.updatedAt).toBe('string');

        // The envelope is the ordinary paginated node list: the full accessible total plus the default page window.
        expect(result).toMatchObject({ total: 1, limit: 50, offset: 0 });
    });
});

//----------------------------------------------------------------------------------------------------------------------
