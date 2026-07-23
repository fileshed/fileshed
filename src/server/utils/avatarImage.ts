//----------------------------------------------------------------------------------------------------------------------
// Avatar Image URL
//
// Derives the UserSummary/MeResponse `image` field from a stored avatar hash: the URL a client fetches the bytes from,
// or null when the account has no avatar. Derived at serialization time on both the /api/me and owner-summary paths --
// the URL is never persisted, so the two serializers agree by sharing this one function.
//----------------------------------------------------------------------------------------------------------------------

// Matches the GET /api/avatars/:sha256 route (mounted under /api). A change to that route's path changes this prefix.
const AVATAR_PATH_PREFIX = '/api/avatars/';

export function avatarImage(sha256 : string | null) : string | null
{
    return sha256 === null ? null : `${ AVATAR_PATH_PREFIX }${ sha256 }`;
}

//----------------------------------------------------------------------------------------------------------------------
