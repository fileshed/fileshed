//----------------------------------------------------------------------------------------------------------------------
// Share Request Codec
//
// The status variants are strict objects in a discriminated union: the pending variant pins resolved to null and the
// resolved variant requires a date, so a mismatched status/resolved pairing fails at parse time.
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
    message: z.string().nullable(),
    created: z.date(),
};

//----------------------------------------------------------------------------------------------------------------------
// Status Variants
//----------------------------------------------------------------------------------------------------------------------

const pendingShareRequestCodec = z.strictObject({
    ...shareRequestBaseShape,
    status: z.literal('pending'),
    resolved: z.null(),
});

const resolvedShareRequestCodec = z.strictObject({
    ...shareRequestBaseShape,
    status: z.enum(resolvedShareRequestStatuses),
    resolved: z.date(),
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
