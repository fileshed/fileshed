//----------------------------------------------------------------------------------------------------------------------
// Public Link Resource Access
//
// The typed client for public-link management: mint a link on a file node, list a node's links, revoke one. The
// response carries the ready-to-use `/d/:token` path, so nothing here rebuilds the direct-serving URL -- that endpoint
// streams bytes to an anonymous visitor and is a plain href, never a JSON fetch. Revoke answers 204 and resolves void.
//----------------------------------------------------------------------------------------------------------------------

import {
    type CreatePublicLinkRequest,
    type PublicLinkListResponse,
    type PublicLinkResponse,
    publicLinkListResponseCodec,
    publicLinkResponseCodec,
} from '@fileshed/core';

// Resource Access
import { requestJson, requestVoid } from './request.ts';

//----------------------------------------------------------------------------------------------------------------------

export async function createPublicLink(nodeID : string, request : CreatePublicLinkRequest) : Promise<PublicLinkResponse>
{
    return requestJson(`/api/nodes/${ nodeID }/links`, {
        method: 'POST',
        body: request,
        codec: publicLinkResponseCodec,
    });
}

export async function listLinksForNode(nodeID : string) : Promise<PublicLinkListResponse>
{
    return requestJson(`/api/nodes/${ nodeID }/links`, { codec: publicLinkListResponseCodec });
}

export async function revokePublicLink(linkID : string) : Promise<void>
{
    return requestVoid(`/api/links/${ linkID }`, { method: 'DELETE' });
}

//----------------------------------------------------------------------------------------------------------------------
