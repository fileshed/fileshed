//----------------------------------------------------------------------------------------------------------------------
// Access Token Resource Access
//
// The create response is the only time a PAT's full value crosses the wire; the playback mint is the media player's own
// short-lived credential, never shown to anyone.
//----------------------------------------------------------------------------------------------------------------------

import {
    type AccessTokenListResponse,
    type AccessTokenScope,
    type CreateAccessTokenResponse,
    type PlaybackTokenResponse,
    accessTokenListResponseCodec,
    createAccessTokenResponseCodec,
    playbackTokenResponseCodec,
} from '@fileshed/core';

// Resource Access
import { requestJSON, requestVoid } from './request.ts';

//----------------------------------------------------------------------------------------------------------------------

export async function createAccessToken(
    name : string,
    scopes : AccessTokenScope[],
    expiresInDays : number | null
) : Promise<CreateAccessTokenResponse>
{
    return requestJSON('/api/me/access-tokens', {
        method: 'POST',
        body: { name, scopes, expiresInDays },
        codec: createAccessTokenResponseCodec,
    });
}

export async function listAccessTokens() : Promise<AccessTokenListResponse>
{
    return requestJSON('/api/me/access-tokens', { codec: accessTokenListResponseCodec });
}

export async function revokeAccessToken(id : string) : Promise<void>
{
    await requestVoid(`/api/me/access-tokens/${ id }`, { method: 'DELETE' });
}

export async function mintPlaybackToken(previousID : string | null) : Promise<PlaybackTokenResponse>
{
    return requestJSON('/api/me/playback-token', {
        method: 'POST',
        body: { previousID },
        codec: playbackTokenResponseCodec,
    });
}

//----------------------------------------------------------------------------------------------------------------------
