//----------------------------------------------------------------------------------------------------------------------
// Served Content Type
//
// What a stored file's declared type becomes on the way out. Storage keeps whatever the uploader said, because that is
// what the app reads to choose a viewer and what a download should be named by; this decides only what the browser is
// told when it is about to render something.
//
// The rule applies to `inline` alone. An attachment is being saved rather than rendered -- the browser will not execute
// a response it is downloading -- so rewriting its type there would cost the user a correctly-typed file for no gain.
//----------------------------------------------------------------------------------------------------------------------

// Models
import {
    type ContentDisposition,
    FALLBACK_MIME_TYPE,
    PLAIN_TEXT_MIME_TYPE,
    isOneOf,
    isValidMimeType,
    renderableMimeFamilies,
    renderableMimeTypes,
} from '@fileshed/core';

//----------------------------------------------------------------------------------------------------------------------

// The bare type, without parameters and case-folded, since `TEXT/HTML` and `text/html; charset=utf-8` are the same
// claim and only one of them looks like it.
function bareType(mimeType : string) : string
{
    return (mimeType.split(';')[0] ?? '').trim().toLowerCase();
}

export function isRenderableMimeType(mimeType : string) : boolean
{
    const bare = bareType(mimeType);

    return renderableMimeFamilies.some((family) => bare.startsWith(family))
        || isOneOf(renderableMimeTypes, bare);
}

//----------------------------------------------------------------------------------------------------------------------

// A stored type no header can carry is served as the generic binary type. The codec refuses an unwritable mime on the
// way in, so this is for rows stored before it did: without it those bytes are unreachable to the owner and to every
// public link, and nothing but replacing the content can repair them.
export function servedContentType(mimeType : string, disposition : ContentDisposition) : string
{
    const servable = isValidMimeType(mimeType) ? mimeType : FALLBACK_MIME_TYPE;
    if(disposition === 'attachment') { return servable; }

    return isRenderableMimeType(servable) ? servable : PLAIN_TEXT_MIME_TYPE;
}

//----------------------------------------------------------------------------------------------------------------------
