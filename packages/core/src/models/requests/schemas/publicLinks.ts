//----------------------------------------------------------------------------------------------------------------------
// Public Link API Codecs
//----------------------------------------------------------------------------------------------------------------------

import { z } from 'zod';

// Models
import type { PublicLink } from '../../publicLink.ts';

// Requests
import { type PublicLinkListResponse, type PublicLinkResponse } from '../publicLinks.ts';

// Request Schemas
import { isoDateTimeCodec } from './common.ts';

// Utils
import { type Equals, typeAssert } from '../../../utils/typeAssert.ts';

//----------------------------------------------------------------------------------------------------------------------

export const publicLinkResponseCodec = z.strictObject({
    id: z.string(),
    nodeID: z.string(),
    token: z.string(),
    url: z.string(),
    createdAt: isoDateTimeCodec,
    revokedAt: isoDateTimeCodec.nullable(),
});

typeAssert<Equals<z.output<typeof publicLinkResponseCodec>, PublicLinkResponse>>();

export const publicLinkListResponseCodec = z.strictObject({
    links: z.array(publicLinkResponseCodec),
});

typeAssert<Equals<z.output<typeof publicLinkListResponseCodec>, PublicLinkListResponse>>();

//----------------------------------------------------------------------------------------------------------------------
// Serialization -- the single domain PublicLink -> wire crossing, so Date fields become ISO strings and the `/d/:token`
// path is derived in exactly one place.
//----------------------------------------------------------------------------------------------------------------------

// Where a token is served: the one place the `/d/<token>` shape is written.
export function publicLinkPath(token : string) : string
{
    return `/d/${ token }`;
}

export function toPublicLinkResponse(link : PublicLink) : PublicLinkResponse
{
    return {
        id: link.id,
        nodeID: link.nodeID,
        token: link.token,
        url: publicLinkPath(link.token),
        createdAt: link.createdAt.toISOString(),
        revokedAt: link.revokedAt === null ? null : link.revokedAt.toISOString(),
    };
}

export function toPublicLinkListResponse(links : readonly PublicLink[]) : PublicLinkListResponse
{
    return { links: links.map(toPublicLinkResponse) };
}

//----------------------------------------------------------------------------------------------------------------------
