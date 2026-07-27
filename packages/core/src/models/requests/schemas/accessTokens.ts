//----------------------------------------------------------------------------------------------------------------------
// Access Token API Codecs
//----------------------------------------------------------------------------------------------------------------------

import { z } from 'zod';

// Models
import { type AccessToken, accessTokenScopes } from '../../accessToken.ts';

// Requests
import {
    type AccessTokenListResponse,
    type AccessTokenResponse,
    type CreateAccessTokenRequest,
    type CreateAccessTokenResponse,
    type CreatePlaybackTokenRequest,
    type PlaybackTokenResponse,
} from '../accessTokens.ts';

// Request Schemas
import { isoDateTimeCodec } from './common.ts';

// Utils
import { type Equals, typeAssert } from '../../../utils/typeAssert.ts';

//----------------------------------------------------------------------------------------------------------------------
// A PAT needs a name and at least one scope; duplicate scopes are rejected rather than silently deduped so a
// malformed caller hears about it. Expiry is whole days, bounded to a year, or null for a non-expiring key.
//----------------------------------------------------------------------------------------------------------------------

export const createAccessTokenRequestCodec = z.strictObject({
    name: z.string().trim()
        .min(1)
        .max(100),
    scopes: z.array(z.enum(accessTokenScopes)).min(1)
        .refine((scopes) => new Set(scopes).size === scopes.length, 'Scopes must be unique.'),
    expiresInDays: z.number().int()
        .min(1)
        .max(365)
        .nullable()
        .default(null),
});

typeAssert<Equals<z.output<typeof createAccessTokenRequestCodec>, CreateAccessTokenRequest>>();

export const accessTokenResponseCodec = z.strictObject({
    id: z.string(),
    name: z.string(),
    start: z.string().nullable(),
    scopes: z.array(z.enum(accessTokenScopes)),
    createdAt: isoDateTimeCodec,
    lastUsedAt: isoDateTimeCodec.nullable(),
    expiresAt: isoDateTimeCodec.nullable(),
});

typeAssert<Equals<z.output<typeof accessTokenResponseCodec>, AccessTokenResponse>>();

export const createAccessTokenResponseCodec = z.strictObject({
    token: z.string(),
    accessToken: accessTokenResponseCodec,
});

typeAssert<Equals<z.output<typeof createAccessTokenResponseCodec>, CreateAccessTokenResponse>>();

export const accessTokenListResponseCodec = z.strictObject({
    accessTokens: z.array(accessTokenResponseCodec),
});

typeAssert<Equals<z.output<typeof accessTokenListResponseCodec>, AccessTokenListResponse>>();

//----------------------------------------------------------------------------------------------------------------------

export const createPlaybackTokenRequestCodec = z.strictObject({
    previousID: z.string().nullable()
        .default(null),
});

typeAssert<Equals<z.output<typeof createPlaybackTokenRequestCodec>, CreatePlaybackTokenRequest>>();

export const playbackTokenResponseCodec = z.strictObject({
    id: z.string(),
    token: z.string(),
    expiresAt: isoDateTimeCodec,
});

typeAssert<Equals<z.output<typeof playbackTokenResponseCodec>, PlaybackTokenResponse>>();

//----------------------------------------------------------------------------------------------------------------------
// Serialization -- the single domain AccessToken -> wire crossing.
//----------------------------------------------------------------------------------------------------------------------

export function toAccessTokenResponse(token : AccessToken) : AccessTokenResponse
{
    return {
        id: token.id,
        name: token.name,
        start: token.start,
        scopes: token.scopes,
        createdAt: token.createdAt.toISOString(),
        lastUsedAt: token.lastUsedAt === null ? null : token.lastUsedAt.toISOString(),
        expiresAt: token.expiresAt === null ? null : token.expiresAt.toISOString(),
    };
}

export function toAccessTokenListResponse(tokens : readonly AccessToken[]) : AccessTokenListResponse
{
    return { accessTokens: tokens.map(toAccessTokenResponse) };
}

//----------------------------------------------------------------------------------------------------------------------
