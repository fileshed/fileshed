//----------------------------------------------------------------------------------------------------------------------
// Share Request Codec
//
// The status variants are strict objects in a discriminated union: the pending variant pins resolvedAt to null and the
// resolved variant requires a date. A mismatched status/resolvedAt pairing fails at parse time, not just at the type
// level.
//----------------------------------------------------------------------------------------------------------------------

import { z } from 'zod';

// Models
import { type ShareRequest, resolvedShareRequestStatuses } from '../shareRequest.ts';

// Schemas
import { shareRoleCodec } from './role.ts';

// Utils
import { type Equals, typeAssert } from '../../utils/typeAssert.ts';

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
    status: z.enum(resolvedShareRequestStatuses),
    resolvedAt: z.date(),
});

//----------------------------------------------------------------------------------------------------------------------

export const shareRequestCodec = z.discriminatedUnion(
    'status',
    [ pendingShareRequestCodec, resolvedShareRequestCodec ]
);

typeAssert<Equals<z.output<typeof shareRequestCodec>, ShareRequest>>();

export function parseShareRequest(data : unknown) : ShareRequest
{
    return shareRequestCodec.parse(data);
}

//----------------------------------------------------------------------------------------------------------------------
