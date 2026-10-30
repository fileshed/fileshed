//----------------------------------------------------------------------------------------------------------------------
// Access Request Resource Access
//----------------------------------------------------------------------------------------------------------------------

import {
    type AccessRequestListResponse,
    type AccessRequestResponse,
    type CreateAccessRequest,
    accessRequestListResponseCodec,
    accessRequestResponseCodec,
} from '@fileshed/core';

// Resource Access
import { requestJSON } from './request.ts';

//----------------------------------------------------------------------------------------------------------------------

export async function requestAccess(nodeID : string, request : CreateAccessRequest) : Promise<AccessRequestResponse>
{
    return requestJSON(`/api/nodes/${ nodeID }/access-requests`, {
        method: 'POST',
        body: request,
        codec: accessRequestResponseCodec,
    });
}

export async function listAccessRequests() : Promise<AccessRequestListResponse>
{
    return requestJSON('/api/access-requests', { codec: accessRequestListResponseCodec });
}

export async function grantAccessRequest(requestID : string) : Promise<AccessRequestResponse>
{
    return requestJSON(`/api/access-requests/${ requestID }/grant`, {
        method: 'POST',
        codec: accessRequestResponseCodec,
    });
}

export async function declineAccessRequest(requestID : string) : Promise<AccessRequestResponse>
{
    return requestJSON(`/api/access-requests/${ requestID }/decline`, {
        method: 'POST',
        codec: accessRequestResponseCodec,
    });
}

//----------------------------------------------------------------------------------------------------------------------
