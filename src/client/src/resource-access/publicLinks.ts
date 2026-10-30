//----------------------------------------------------------------------------------------------------------------------
// Public Link Resource Access
//
// The response carries the ready-to-use `/d/:token` path, so nothing here builds the direct-serving URL; that endpoint
// is a plain href, never a JSON fetch.
//----------------------------------------------------------------------------------------------------------------------

import {
    type PublicLinkListResponse,
    type PublicLinkResponse,
    publicLinkListResponseCodec,
    publicLinkResponseCodec,
} from '@fileshed/core';

// Resource Access
import { requestJSON, requestVoid } from './request.ts';

//----------------------------------------------------------------------------------------------------------------------

export async function createPublicLink(nodeID : string) : Promise<PublicLinkResponse>
{
    return requestJSON(`/api/nodes/${ nodeID }/links`, {
        method: 'POST',
        codec: publicLinkResponseCodec,
    });
}

export async function listLinksForNode(nodeID : string) : Promise<PublicLinkListResponse>
{
    return requestJSON(`/api/nodes/${ nodeID }/links`, { codec: publicLinkListResponseCodec });
}

export async function revokePublicLink(linkID : string) : Promise<void>
{
    return requestVoid(`/api/links/${ linkID }`, { method: 'DELETE' });
}

//----------------------------------------------------------------------------------------------------------------------
