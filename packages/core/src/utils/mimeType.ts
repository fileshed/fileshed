//----------------------------------------------------------------------------------------------------------------------
// MIME Types
//----------------------------------------------------------------------------------------------------------------------

// Constants
import { MIME_FAMILY_SPECS, mimeFamilies } from '../constants/nodeType.ts';
import { MIME_TYPE_MAX_LENGTH } from '../constants/node.ts';
import { PLAYLIST_EXTENSIONS, PLAYLIST_MIME_TYPES } from '../constants/media.ts';

// Models
import type { NodeTypeFamily } from '../models/requests/nodes.ts';

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

// The file type-family a mime type belongs to, or null when it matches none (an unclassified binary). The families are
// mutually exclusive by mime, so the iteration order only decides ties that cannot currently arise.
export function familyOfMimeType(mimeType : string) : NodeTypeFamily | null
{
    // A media type is case-insensitive, and the family specs are written lowercase. Nothing normalizes what an API
    // client supplied, so the comparison does it -- the server's own family filter matches the same way.
    const mime = mimeType.toLowerCase();

    for(const family of mimeFamilies)
    {
        const spec = MIME_FAMILY_SPECS[family];
        if(spec.prefixes.some((prefix) => mime.startsWith(prefix))) { return family; }
        if(spec.exact.includes(mime)) { return family; }
    }

    return null;
}

// A playlist by declared type or by extension -- browsers and servers disagree on m3u mimes often enough that the
// name is the more reliable witness. Beside familyOfMimeType because it plays the same classifying role: the drive's
// presentation and the client's open-intent registry both key off it.
export function isPlaylistFile(mimeType : string, name : string) : boolean
{
    if(PLAYLIST_MIME_TYPES.has(mimeType)) { return true; }

    const lower = name.toLowerCase();

    return PLAYLIST_EXTENSIONS.some((extension) => lower.endsWith(extension));
}

//----------------------------------------------------------------------------------------------------------------------
