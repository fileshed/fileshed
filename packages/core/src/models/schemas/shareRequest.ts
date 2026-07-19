//----------------------------------------------------------------------------------------------------------------------
// Share Request Codec
//
// The status variants are strict objects in a discriminated union: the pending variant pins resolvedAt to null and the
// resolved variant requires a date. A mismatched status/resolvedAt pairing fails at parse time, not just at the type
// level (requirements.md secs 3.1/3.5/3.6).
//----------------------------------------------------------------------------------------------------------------------

import { z } from 'zod';

// Models
import type { ShareRequest } from '../shareRequest.ts';

// Schemas
import { shareRoleCodec } from './role.ts';

//----------------------------------------------------------------------------------------------------------------------

const shareRequestBaseShape = {
    id: z.string(),
    nodeID: z.string(),
    requesterID: z.string(),
    requestedRole: shareRoleCodec,
    createdAt: z.date(),
};

//----------------------------------------------------------------------------------------------------------------------
// Status Variants
//----------------------------------------------------------------------------------------------------------------------

const pendingShareRequestCodec = z.strictObject({
    ...shareRequestBaseShape,
    status: z.literal('pending'),
    resolvedAt: z.null(),
});

const resolvedShareRequestCodec = z.strictObject({
    ...shareRequestBaseShape,
    status: z.literal([ 'granted', 'declined' ]),
    resolvedAt: z.date(),
});

//----------------------------------------------------------------------------------------------------------------------

export const shareRequestCodec = z.discriminatedUnion(
    'status',
    [ pendingShareRequestCodec, resolvedShareRequestCodec ]
);

export function parseShareRequest(data : unknown) : ShareRequest
{
    return shareRequestCodec.parse(data);
}

//----------------------------------------------------------------------------------------------------------------------
