//----------------------------------------------------------------------------------------------------------------------
// Public Link API Codecs
//----------------------------------------------------------------------------------------------------------------------

import { z } from 'zod';

// Models
import { type PublicLink, publicLinkDispositions, publicLinkModes } from '../../publicLink.ts';

// Requests
import {
    type CreatePublicLinkRequest,
    type PublicLinkListResponse,
    type PublicLinkResponse,
} from '../publicLinks.ts';

// Request Schemas
import { isoDateTimeCodec } from './common.ts';

// Utils
import { type Equals, typeAssert } from '../../../utils/typeAssert.ts';

//----------------------------------------------------------------------------------------------------------------------
// mode and disposition both default to the download/attachment pair, the safe choice when a caller states only that
// they want a link.
//----------------------------------------------------------------------------------------------------------------------

export const createPublicLinkRequestCodec = z.strictObject({
    mode: z.enum(publicLinkModes).default('download'),
    disposition: z.enum(publicLinkDispositions).default('attachment'),
});

typeAssert<Equals<z.output<typeof createPublicLinkRequestCodec>, CreatePublicLinkRequest>>();

export const publicLinkResponseCodec = z.strictObject({
    id: z.string(),
    nodeID: z.string(),
    token: z.string(),
    mode: z.enum(publicLinkModes),
    disposition: z.enum(publicLinkDispositions),
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

export function toPublicLinkResponse(link : PublicLink) : PublicLinkResponse
{
    return {
        id: link.id,
        nodeID: link.nodeID,
        token: link.token,
        mode: link.mode,
        disposition: link.disposition,
        url: `/d/${ link.token }`,
        createdAt: link.createdAt.toISOString(),
        revokedAt: link.revokedAt === null ? null : link.revokedAt.toISOString(),
    };
}

export function toPublicLinkListResponse(links : readonly PublicLink[]) : PublicLinkListResponse
{
    return { links: links.map(toPublicLinkResponse) };
}

//----------------------------------------------------------------------------------------------------------------------
