//----------------------------------------------------------------------------------------------------------------------
// Node Resource Access
//
// The typed client for the /api/nodes surface: read a node, list a folder's children (or the root, when parentID is
// null), create folders and links, rename/move via patch, trash and restore, copy, purge a folder's broken links, and
// permanently delete. Every response is validated against its core codec; a hard delete answers 204 and resolves void.
//----------------------------------------------------------------------------------------------------------------------

import {
    type ChildrenQuery,
    type CopyNodeRequest,
    type CreateNodeRequest,
    type NodeListResponse,
    type NodeResponse,
    type PatchNodeRequest,
    type PurgeBrokenLinksResponse,
    nodeListResponseCodec,
    nodeResponseCodec,
    purgeBrokenLinksResponseCodec,
} from '@fileshed/core';

// Resource Access
import { requestJson, requestVoid } from './request.ts';

//----------------------------------------------------------------------------------------------------------------------

export async function getNode(id : string) : Promise<NodeResponse>
{
    return requestJson(`/api/nodes/${ id }`, { codec: nodeResponseCodec });
}

// A folder's children, or the caller's root when parentID is null. Pagination and sort default server-side, so a caller
// may pass only the fields it cares about.
export async function getChildren(
    parentID : string | null,
    query : Partial<ChildrenQuery> = {}
) : Promise<NodeListResponse>
{
    const path = parentID === null ? '/api/nodes/children' : `/api/nodes/${ parentID }/children`;

    return requestJson(path, { query: { ...query }, codec: nodeListResponseCodec });
}

export async function createNode(request : CreateNodeRequest) : Promise<NodeResponse>
{
    return requestJson('/api/nodes', { method: 'POST', body: request, codec: nodeResponseCodec });
}

export async function patchNode(id : string, patch : PatchNodeRequest) : Promise<NodeResponse>
{
    return requestJson(`/api/nodes/${ id }`, { method: 'PATCH', body: patch, codec: nodeResponseCodec });
}

export async function trashNode(id : string) : Promise<NodeResponse>
{
    return requestJson(`/api/nodes/${ id }/trash`, { method: 'POST', codec: nodeResponseCodec });
}

export async function restoreNode(id : string) : Promise<NodeResponse>
{
    return requestJson(`/api/nodes/${ id }/restore`, { method: 'POST', codec: nodeResponseCodec });
}

export async function copyNode(id : string, request : CopyNodeRequest) : Promise<NodeResponse>
{
    return requestJson(`/api/nodes/${ id }/copy`, { method: 'POST', body: request, codec: nodeResponseCodec });
}

export async function purgeBrokenLinks(id : string) : Promise<PurgeBrokenLinksResponse>
{
    return requestJson(`/api/nodes/${ id }/purge-broken-links`, {
        method: 'POST',
        codec: purgeBrokenLinksResponseCodec,
    });
}

// Permanently delete a node. offerCopies opts recipients into saving their own copy of a shared file before it goes;
// absent (the default) deletes for everyone.
export async function hardDeleteNode(id : string, offerCopies = false) : Promise<void>
{
    return requestVoid(`/api/nodes/${ id }`, { method: 'DELETE', query: { offerCopies } });
}

//----------------------------------------------------------------------------------------------------------------------
