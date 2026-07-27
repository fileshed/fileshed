//----------------------------------------------------------------------------------------------------------------------
// Access Token Routes OpenAPI Spec
//----------------------------------------------------------------------------------------------------------------------

import { describeRoute } from 'hono-openapi';

// Models
import {
    accessTokenListResponseCodec,
    createAccessTokenRequestCodec,
    createAccessTokenResponseCodec,
    createPlaybackTokenRequestCodec,
    playbackTokenResponseCodec,
} from '@fileshed/core';

// Routes
import { errorResponse, jsonBody, jsonResponse } from './docSchema.ts';

//----------------------------------------------------------------------------------------------------------------------

const TOKEN_TAG = 'Access Tokens';

//----------------------------------------------------------------------------------------------------------------------

export const createAccessTokenSpec = describeRoute({
    tags: [ TOKEN_TAG ],
    summary: 'Create an access token',
    description: 'Mints a personal access token carrying the chosen scopes, frozen at creation. The response is the '
        + 'ONLY time the full token value appears -- it is hashed at rest and cannot be shown again. Session-only: '
        + 'a token can never mint tokens.',
    requestBody: jsonBody(createAccessTokenRequestCodec),
    responses: {
        200: jsonResponse('The one-time token value plus its stored record.', createAccessTokenResponseCodec),
        400: errorResponse('The request is malformed.'),
        401: errorResponse('No session.'),
    },
});

export const listAccessTokensSpec = describeRoute({
    tags: [ TOKEN_TAG ],
    summary: 'List access tokens',
    description: 'The caller\'s personal access tokens, newest first: name, identifying starting characters, scopes, '
        + 'and lifecycle timestamps -- never the token value. Playback keys are a different kind and never appear '
        + 'here.',
    responses: {
        200: jsonResponse('The caller\'s tokens.', accessTokenListResponseCodec),
        401: errorResponse('No session.'),
    },
});

export const revokeAccessTokenSpec = describeRoute({
    tags: [ TOKEN_TAG ],
    summary: 'Revoke an access token',
    description: 'Deletes the token immediately; the credential is dead from the next request on. Another user\'s '
        + 'token reads as absent.',
    responses: {
        204: { description: 'Revoked.' },
        401: errorResponse('No session.'),
        404: errorResponse('No such token.'),
    },
});

export const createPlaybackTokenSpec = describeRoute({
    tags: [ TOKEN_TAG ],
    summary: 'Mint a playback token',
    description: 'A short-lived download-scoped key for media playback: cast receivers fetch media URLs without '
        + 'cookies, so the credential rides the URL. Expires on its own; the player re-mints near expiry and may '
        + 'name its predecessor to retire it early. Session-only, never listed, never named.',
    requestBody: jsonBody(createPlaybackTokenRequestCodec),
    responses: {
        200: jsonResponse('The playback token and its expiry.', playbackTokenResponseCodec),
        401: errorResponse('No session.'),
    },
});

//----------------------------------------------------------------------------------------------------------------------
