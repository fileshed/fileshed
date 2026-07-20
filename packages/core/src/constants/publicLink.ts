//----------------------------------------------------------------------------------------------------------------------
// Public Link Constants
//
// The token width for anonymous direct links (entropy >= 128 bits, no auth on /d/:token). 32 random bytes is 256 bits
// -- comfortably above the floor -- and base64url-encodes to a 43-char URL-safe token.
//----------------------------------------------------------------------------------------------------------------------

export const PUBLIC_LINK_TOKEN_BYTES = 32;

//----------------------------------------------------------------------------------------------------------------------
