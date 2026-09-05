//----------------------------------------------------------------------------------------------------------------------
// Request Limits
//----------------------------------------------------------------------------------------------------------------------

// The ceiling on a JSON request body. Every /api body is a DTO of bounded fields; the largest legitimate one is the
// branding document carrying CUSTOM_CSS_MAX_LENGTH of custom CSS, so a mebibyte leaves an order of magnitude of
// headroom. The routes that move bytes rather than JSON -- the upload PUT, the avatar and logo posts -- are exempt and
// carry ceilings of their own.
export const API_BODY_MAX_BYTES = 1024 * 1024;

//----------------------------------------------------------------------------------------------------------------------
