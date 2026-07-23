//----------------------------------------------------------------------------------------------------------------------
// Access Request API Codecs
//----------------------------------------------------------------------------------------------------------------------

import { z } from 'zod';

// Constants
import { ACCESS_REQUEST_MESSAGE_MAX_CHARS } from '../../../constants/accessRequest.ts';

// Models
import { type ShareRequest, shareRequestStatuses } from '../../shareRequest.ts';
import { shareRoleCodec } from '../../schemas/role.ts';

// Requests
import type { UserSummary } from '../nodes.ts';
import {
    type AccessRequestListEntry,
    type AccessRequestListResponse,
    type AccessRequestResponse,
    type CreateAccessRequest,
} from '../accessRequests.ts';

// Request Schemas
import { isoDateTimeCodec } from './common.ts';
import { userSummaryCodec } from './nodes.ts';

// Utils
import { type Equals, typeAssert } from '../../../utils/typeAssert.ts';

//----------------------------------------------------------------------------------------------------------------------

// message is trimmed, capped, and an empty result collapses to absent -- "   " and "" are the same as never asking.
export const createAccessRequestCodec = z.strictObject({
    requestedRole: shareRoleCodec,
    message: z.string()
        .trim()
        .max(ACCESS_REQUEST_MESSAGE_MAX_CHARS)
        .transform((value) =>
        {
            if(value === '') { return undefined; }
            return value;
        })
        .optional(),
});

typeAssert<Equals<z.output<typeof createAccessRequestCodec>, CreateAccessRequest>>();

export const accessRequestResponseCodec = z.strictObject({
    id: z.string(),
    nodeID: z.string(),
    requesterID: z.string(),
    requestedRole: shareRoleCodec,
    message: z.string().nullable(),
    status: z.enum(shareRequestStatuses),
    createdAt: isoDateTimeCodec,
    resolvedAt: isoDateTimeCodec.nullable(),
});

typeAssert<Equals<z.output<typeof accessRequestResponseCodec>, AccessRequestResponse>>();

export const accessRequestListEntryCodec = z.strictObject({
    request: accessRequestResponseCodec,
    requester: userSummaryCodec,
});

typeAssert<Equals<z.output<typeof accessRequestListEntryCodec>, AccessRequestListEntry>>();

export const accessRequestListResponseCodec = z.strictObject({
    incoming: z.array(accessRequestListEntryCodec),
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
        message: request.message,
        status: request.status,
        createdAt: request.createdAt.toISOString(),
        resolvedAt: request.resolvedAt === null ? null : request.resolvedAt.toISOString(),
    };
}

export function toAccessRequestListEntry(request : ShareRequest, requester : UserSummary) : AccessRequestListEntry
{
    return { request: toAccessRequestResponse(request), requester };
}

//----------------------------------------------------------------------------------------------------------------------
