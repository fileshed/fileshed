//----------------------------------------------------------------------------------------------------------------------
// Public Link Constants
//
// /d/:token has no auth, so a direct-link token needs at least 128 bits of entropy. 32 random bytes is 256 bits and
// base64url-encodes to a 43-character URL-safe token.
//----------------------------------------------------------------------------------------------------------------------

export const PUBLIC_LINK_TOKEN_BYTES = 32;

// How many live links one node may carry. Several is the point -- separately revocable tokens for separate audiences
// -- but a node accumulating dozens is a script, and every one of them is a row and a line in the owner's own listing.
// Revoked links do not count: a token that serves nothing costs the owner nothing.
export const MAX_LINKS_PER_NODE = 20;

//----------------------------------------------------------------------------------------------------------------------
