//----------------------------------------------------------------------------------------------------------------------
// Access Token API DTOs
//
// Request/response contracts for PAT management and playback-token minting, both session-only surfaces: no token
// mints, lists, or revokes tokens. The create response is the only place a PAT's full value ever appears -- the key
// is hashed at rest, so it is shown once and never again; the list carries only the stored starting characters.
// Playback tokens are the media player's own short-lived download-scoped keys: never listed, never named, identified
// only by the id the player holds so it can retire its predecessor on refresh.
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
    createdAt : string;
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
