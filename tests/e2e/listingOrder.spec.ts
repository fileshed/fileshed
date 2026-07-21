//----------------------------------------------------------------------------------------------------------------------
// E2E — Children listing order: folders first, across pages, over the wire
//
// The folders-first listing invariant driven over a real socket: in every children listing, folders sort above the
// file/link partition regardless of the sort key or its direction, and -- because a paginated client cannot
// re-partition -- the invariant has to hold across page boundaries the server alone controls. A folder whose name
// sorts dead last still leads page one; it never spills onto a later page. Descending order flips only the sort within
// each partition, never the folders-first criterion.
//----------------------------------------------------------------------------------------------------------------------

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { NodeListResponse, NodeResponse } from '@fileshed/core';

// Support
import { ApiClient, type ServerHandle, spawnServer } from './support.ts';

//----------------------------------------------------------------------------------------------------------------------

const PASSWORD = 'correct-horse-battery';

let server : ServerHandle;
let user : ApiClient;
let parentID : string;

async function makeFolder(name : string, parent : string | null = null) : Promise<NodeResponse>
{
    return await (await user.post('/api/nodes', { type: 'folder', name, parentID: parent })).json() as NodeResponse;
}

async function makeLink(name : string, targetNodeID : string, parent : string | null) : Promise<NodeResponse>
{
    return await (await user.post('/api/nodes', { type: 'link', name, targetNodeID, parentID: parent }))
        .json() as NodeResponse;
}

function childrenPath(query : string) : string
{
    return `/api/nodes/${ parentID }/children?${ query }`;
}

async function listing(path : string) : Promise<NodeListResponse>
{
    const res = await user.get(path);
    expect(res.status).toBe(200);
    return await res.json() as NodeListResponse;
}

//----------------------------------------------------------------------------------------------------------------------

beforeAll(async () =>
{
    server = await spawnServer();

    user = new ApiClient(server.baseURL);
    await user.signUp('order@example.com', PASSWORD);

    const target = await makeFolder('target');
    const parent = await makeFolder('parent');
    parentID = parent.id;

    // Under `parent`: three links whose names sort first, and one folder whose name sorts last. Naive name order would
    // put the folder on page two; folders-first must pull it to the top of page one.
    await makeFolder('zzz', parentID);
    await makeLink('aaa', target.id, parentID);
    await makeLink('bbb', target.id, parentID);
    await makeLink('ccc', target.id, parentID);
});

afterAll(async () =>
{
    await server?.stop();
});

//----------------------------------------------------------------------------------------------------------------------

describe('children listing order', () =>
{
    it('pins a folder to the first page though its name sorts last, and never spills it onto page two', async () =>
    {
        const page1 = await listing(childrenPath('sortKey=name&sortDirection=asc&limit=2&offset=0'));
        const page2 = await listing(childrenPath('sortKey=name&sortDirection=asc&limit=2&offset=2'));

        expect(page1.total).toBe(4);
        expect(page1.nodes.map((node) => node.name)).toEqual([ 'zzz', 'aaa' ]);
        expect(page1.nodes[0]?.type).toBe('folder');

        expect(page2.nodes.map((node) => node.name)).toEqual([ 'bbb', 'ccc' ]);
        expect(page2.nodes.some((node) => node.type === 'folder')).toBe(false);
    });

    it('keeps the folder on top under descending order, flipping only the partition sort', async () =>
    {
        const page = await listing(childrenPath('sortKey=name&sortDirection=desc&limit=50'));

        expect(page.nodes.map((node) => node.name)).toEqual([ 'zzz', 'ccc', 'bbb', 'aaa' ]);
    });
});

//----------------------------------------------------------------------------------------------------------------------
