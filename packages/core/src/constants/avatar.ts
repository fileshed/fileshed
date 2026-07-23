//----------------------------------------------------------------------------------------------------------------------
// Avatar Constants
//----------------------------------------------------------------------------------------------------------------------

// The image formats an avatar may be. Format support, not a deployment knob -- the byte cap is the tunable one
// (AVATAR_MAX_BYTES in the server config). The server enforces this whitelist on upload; the client pre-filters the
// file picker against the same list.
export const avatarMimeTypes = [ 'image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/bmp' ] as const;

export type AvatarMimeType = typeof avatarMimeTypes[number];

//----------------------------------------------------------------------------------------------------------------------
