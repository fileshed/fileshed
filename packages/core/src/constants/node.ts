//----------------------------------------------------------------------------------------------------------------------
// Node Content Constraints
//
// What a node's two user-supplied identity fields may be. The mime type is the sharper of the pair: it is emitted
// verbatim as a Content-Type header when the bytes are served, so the grammar here is the header's. A value outside it
// cannot be written to a response at all, which leaves the node unreadable for as long as it is stored -- and an
// editor may set it on a node they do not own.
//----------------------------------------------------------------------------------------------------------------------

// Every mainstream filesystem stops a single path component at 255, so a name that fits here also survives an export.
export const NODE_NAME_MAX_LENGTH = 255;

// Long enough for the longest registered type (the OOXML family runs to 73 characters) plus parameters, short enough
// that a name-shaped payload cannot ride in the mime slot instead.
export const MIME_TYPE_MAX_LENGTH = 255;

// What a file is when nothing better is known -- what an unreadable stored mime falls back to on the way out.
export const FALLBACK_MIME_TYPE = 'application/octet-stream';

//----------------------------------------------------------------------------------------------------------------------

// RFC 9110 media-type: `type/subtype` of tokens, then any number of `;name=value` parameters whose values are tokens
// or quoted strings. Every character the grammar admits is printable ASCII, which is what makes a value that passes
// safe to emit -- CR, LF, DEL and everything above U+007F are outside it.
const TOKEN = String.raw`[A-Za-z0-9!#$%&'*+.^_\`|~-]+`;
const QUOTED = String.raw`"[\x20\x21\x23-\x5b\x5d-\x7e]*"`;
const MEDIA_TYPE = new RegExp(`^${ TOKEN }/${ TOKEN }(?:[ \t]*;[ \t]*${ TOKEN }=(?:${ TOKEN }|${ QUOTED }))*$`);

export function isValidMimeType(value : string) : boolean
{
    return value.length <= MIME_TYPE_MAX_LENGTH && MEDIA_TYPE.test(value);
}

//----------------------------------------------------------------------------------------------------------------------
