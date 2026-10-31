//----------------------------------------------------------------------------------------------------------------------
// Avatar Image URL
//
// The URL is never persisted. The /api/me and owner-summary serializers both derive it here, so the two agree.
//----------------------------------------------------------------------------------------------------------------------

// Matches the GET /api/avatars/:sha256 route (mounted under /api). A change to that route's path changes this prefix.
const AVATAR_PATH_PREFIX = '/api/avatars/';

export function avatarImage(sha256 : string | null) : string | null
{
    return sha256 === null ? null : `${ AVATAR_PATH_PREFIX }${ sha256 }`;
}

//----------------------------------------------------------------------------------------------------------------------
