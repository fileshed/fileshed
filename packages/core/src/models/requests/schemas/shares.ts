//----------------------------------------------------------------------------------------------------------------------
// Share API Codecs
//----------------------------------------------------------------------------------------------------------------------

import { z } from 'zod';

// Models
import { nodeTypes } from '../../node.ts';
import type { Share } from '../../share.ts';
import { shareRoleCodec } from '../../schemas/role.ts';

// Requests
import type { UserSummary } from '../nodes.ts';
import {
    type GrantShareRequest,
    type ShareListEntry,
    type ShareListResponse,
    type ShareResponse,
    type SharedTarget,
    type SharedWithMeEntry,
    type SharedWithMeQuery,
    type SharedWithMeResponse,
} from '../shares.ts';

// Request Schemas
import { isoDateTimeCodec } from './common.ts';
import { typeFamiliesParam, userSummaryCodec } from './nodes.ts';

// Utils
import { type Equals, typeAssert } from '../../../utils/typeAssert.ts';

//----------------------------------------------------------------------------------------------------------------------

export const grantShareRequestCodec = z.strictObject({
    granteeUserID: z.string(),
    role: shareRoleCodec,
});

typeAssert<Equals<z.output<typeof grantShareRequestCodec>, GrantShareRequest>>();

export const shareResponseCodec = z.strictObject({
    id: z.string(),
    nodeID: z.string(),
    granteeUserID: z.string(),
    role: shareRoleCodec,
    createdBy: z.string(),
    createdAt: isoDateTimeCodec,
});

typeAssert<Equals<z.output<typeof shareResponseCodec>, ShareResponse>>();

export const shareListEntryCodec = z.strictObject({
    share: shareResponseCodec,
    grantee: userSummaryCodec,
});

typeAssert<Equals<z.output<typeof shareListEntryCodec>, ShareListEntry>>();

export const shareListResponseCodec = z.strictObject({
    shares: z.array(shareListEntryCodec),
});

typeAssert<Equals<z.output<typeof shareListResponseCodec>, ShareListResponse>>();

export const sharedTargetCodec = z.strictObject({
    id: z.string(),
    type: z.enum(nodeTypes),
    name: z.string(),
    ownerID: z.string(),
    mimeType: z.string().optional(),
    size: z.number().optional(),
});

typeAssert<Equals<z.output<typeof sharedTargetCodec>, SharedTarget>>();

export const sharedWithMeEntryCodec = z.strictObject({
    share: shareResponseCodec,
    target: sharedTargetCodec,
    owner: userSummaryCodec,
    placed: z.boolean(),
});

typeAssert<Equals<z.output<typeof sharedWithMeEntryCodec>, SharedWithMeEntry>>();

export const sharedWithMeResponseCodec = z.strictObject({
    entries: z.array(sharedWithMeEntryCodec),
});

typeAssert<Equals<z.output<typeof sharedWithMeResponseCodec>, SharedWithMeResponse>>();

// The Type/Modified filters ride the query string exactly as the children listing's do: types as one comma-separated
// param (absent or empty = unfiltered), the date bounds as full ISO instants.
export const sharedWithMeQueryCodec = z.strictObject({
    types: typeFamiliesParam,
    updatedAfter: z.iso.datetime().optional(),
    updatedBefore: z.iso.datetime().optional(),
});

typeAssert<Equals<z.output<typeof sharedWithMeQueryCodec>, SharedWithMeQuery>>();

//----------------------------------------------------------------------------------------------------------------------
// Serialization -- the single domain Share -> wire ShareResponse crossing, so createdAt becomes an ISO string in
// exactly one place (isoDateTimeCodec's format).
//----------------------------------------------------------------------------------------------------------------------

export function toShareResponse(share : Share) : ShareResponse
{
    return {
        id: share.id,
        nodeID: share.nodeID,
        granteeUserID: share.granteeUserID,
        role: share.role,
        createdBy: share.createdBy,
        createdAt: share.createdAt.toISOString(),
    };
}

export function toShareListEntry(share : Share, grantee : UserSummary) : ShareListEntry
{
    return { share: toShareResponse(share), grantee };
}

export function toSharedWithMeEntry(
    share : Share,
    target : SharedTarget,
    owner : UserSummary,
    placed : boolean
) : SharedWithMeEntry
{
    return { share: toShareResponse(share), target, owner, placed };
}

//----------------------------------------------------------------------------------------------------------------------
