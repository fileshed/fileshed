//----------------------------------------------------------------------------------------------------------------------
// Share Resource Access
//
// The typed client for the sharing surface: grant a share on a node, list a node's grants, the caller's shared-with-me
// listing, leaving a share granted to you, and revoking one you granted. Leave and revoke answer 204 and resolve void.
//----------------------------------------------------------------------------------------------------------------------

import {
    type GrantShareRequest,
    type ShareListResponse,
    type ShareResponse,
    type SharedWithMeQuery,
    type SharedWithMeResponse,
    shareListResponseCodec,
    shareResponseCodec,
    sharedWithMeResponseCodec,
} from '@fileshed/core';

// Resource Access
import { type QueryParams, requestJson, requestVoid } from './request.ts';

//----------------------------------------------------------------------------------------------------------------------

export async function grantShare(nodeID : string, request : GrantShareRequest) : Promise<ShareResponse>
{
    return requestJson(`/api/nodes/${ nodeID }/shares`, { method: 'POST', body: request, codec: shareResponseCodec });
}

export async function listSharesForNode(nodeID : string) : Promise<ShareListResponse>
{
    return requestJson(`/api/nodes/${ nodeID }/shares`, { codec: shareListResponseCodec });
}

// The caller's shared-with-me listing, optionally narrowed by the Type/Modified filters on each target. The type
// families ride one comma-separated param; an empty selection and absent date bounds are dropped, so an unfiltered
// call issues a bare GET with no query string.
export async function sharedWithMe(query : Partial<SharedWithMeQuery> = {}) : Promise<SharedWithMeResponse>
{
    const { types, ...rest } = query;
    const params : QueryParams = { ...rest };
    if(types !== undefined && types.length > 0) { params.types = types.join(','); }

    return requestJson('/api/shared-with-me', { query: params, codec: sharedWithMeResponseCodec });
}

export async function leaveShare(shareID : string) : Promise<void>
{
    return requestVoid(`/api/shares/${ shareID }/leave`, { method: 'POST' });
}

export async function revokeShare(shareID : string) : Promise<void>
{
    return requestVoid(`/api/shares/${ shareID }`, { method: 'DELETE' });
}

//----------------------------------------------------------------------------------------------------------------------
