//----------------------------------------------------------------------------------------------------------------------
// Access Request Resource Access
//
// The typed client for share requests: ask a target's owner for access to a stub, list requests in both directions
// (incoming to you as an owner, your own outgoing), and grant or decline one as the owner. Grant and decline both
// answer the resolved request.
//----------------------------------------------------------------------------------------------------------------------

import {
    type AccessRequestListResponse,
    type AccessRequestResponse,
    type CreateAccessRequest,
    accessRequestListResponseCodec,
    accessRequestResponseCodec,
} from '@fileshed/core';

// Resource Access
import { requestJson } from './request.ts';

//----------------------------------------------------------------------------------------------------------------------

export async function requestAccess(nodeID : string, request : CreateAccessRequest) : Promise<AccessRequestResponse>
{
    return requestJson(`/api/nodes/${ nodeID }/access-requests`, {
        method: 'POST',
        body: request,
        codec: accessRequestResponseCodec,
    });
}

export async function listAccessRequests() : Promise<AccessRequestListResponse>
{
    return requestJson('/api/access-requests', { codec: accessRequestListResponseCodec });
}

export async function grantAccessRequest(requestID : string) : Promise<AccessRequestResponse>
{
    return requestJson(`/api/access-requests/${ requestID }/grant`, {
        method: 'POST',
        codec: accessRequestResponseCodec,
    });
}

export async function declineAccessRequest(requestID : string) : Promise<AccessRequestResponse>
{
    return requestJson(`/api/access-requests/${ requestID }/decline`, {
        method: 'POST',
        codec: accessRequestResponseCodec,
    });
}

//----------------------------------------------------------------------------------------------------------------------
