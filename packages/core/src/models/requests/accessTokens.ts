//----------------------------------------------------------------------------------------------------------------------
// Access Token API DTOs
//
// Both surfaces are session-only: no token mints, lists, or revokes tokens. The key is hashed at rest, so the create
// response is the only place a PAT's full value ever appears; the list carries only the stored starting characters.
// Playback tokens are never listed or named, and are identified only by the id the player holds so it can retire its
// predecessor on refresh.
//----------------------------------------------------------------------------------------------------------------------

// Models
import type { AccessTokenScope } from '../accessToken.ts';

//----------------------------------------------------------------------------------------------------------------------
// PAT management (POST/GET/DELETE /api/me/access-tokens)
//----------------------------------------------------------------------------------------------------------------------

export interface CreateAccessTokenRequest
{
    name : string;
    scopes : AccessTokenScope[];
    expiresInDays : number | null;
}

export interface AccessTokenResponse
{
    id : string;
    name : string;
    start : string | null;
    scopes : AccessTokenScope[];
    created : string;
    lastUsedAt : string | null;
    expiresAt : string | null;
}

export interface CreateAccessTokenResponse
{
    token : string;
    accessToken : AccessTokenResponse;
}

export interface AccessTokenListResponse
{
    accessTokens : AccessTokenResponse[];
}

//----------------------------------------------------------------------------------------------------------------------
// Playback token (POST /api/me/playback-token) -- previousID lets the player retire the key it is replacing.
//----------------------------------------------------------------------------------------------------------------------

export interface CreatePlaybackTokenRequest
{
    previousID : string | null;
}

export interface PlaybackTokenResponse
{
    id : string;
    token : string;
    expiresAt : string;
}

//----------------------------------------------------------------------------------------------------------------------
