//----------------------------------------------------------------------------------------------------------------------
// Access Request API Codecs
//----------------------------------------------------------------------------------------------------------------------

import { z } from 'zod';

// Models
import { type ShareRequest, shareRequestStatuses } from '../../shareRequest.ts';
import { shareRoleCodec } from '../../schemas/role.ts';

// Requests
import {
    type AccessRequestListResponse,
    type AccessRequestResponse,
    type CreateAccessRequest,
} from '../accessRequests.ts';

// Request Schemas
import { isoDateTimeCodec } from './common.ts';

// Utils
import { type Equals, typeAssert } from '../../../utils/typeAssert.ts';

//----------------------------------------------------------------------------------------------------------------------

export const createAccessRequestCodec = z.strictObject({
    requestedRole: shareRoleCodec,
});

typeAssert<Equals<z.output<typeof createAccessRequestCodec>, CreateAccessRequest>>();

export const accessRequestResponseCodec = z.strictObject({
    id: z.string(),
    nodeID: z.string(),
    requesterID: z.string(),
    requestedRole: shareRoleCodec,
    status: z.enum(shareRequestStatuses),
    createdAt: isoDateTimeCodec,
    resolvedAt: isoDateTimeCodec.nullable(),
});

typeAssert<Equals<z.output<typeof accessRequestResponseCodec>, AccessRequestResponse>>();

export const accessRequestListResponseCodec = z.strictObject({
    incoming: z.array(accessRequestResponseCodec),
    outgoing: z.array(accessRequestResponseCodec),
});

typeAssert<Equals<z.output<typeof accessRequestListResponseCodec>, AccessRequestListResponse>>();

//----------------------------------------------------------------------------------------------------------------------
// Serialization -- the single domain ShareRequest -> wire crossing. Both timestamps become ISO strings here; the union
// on status guarantees resolvedAt is a Date exactly when the request is resolved, null when pending.
//----------------------------------------------------------------------------------------------------------------------

export function toAccessRequestResponse(request : ShareRequest) : AccessRequestResponse
{
    return {
        id: request.id,
        nodeID: request.nodeID,
        requesterID: request.requesterID,
        requestedRole: request.requestedRole,
        status: request.status,
        createdAt: request.createdAt.toISOString(),
        resolvedAt: request.resolvedAt === null ? null : request.resolvedAt.toISOString(),
    };
}

//----------------------------------------------------------------------------------------------------------------------
