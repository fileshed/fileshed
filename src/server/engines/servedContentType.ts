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
    PLAIN_TEXT_MIME_TYPE,
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
        || (renderableMimeTypes as readonly string[]).includes(bare);
}

//----------------------------------------------------------------------------------------------------------------------

export function servedContentType(mimeType : string, disposition : ContentDisposition) : string
{
    if(disposition === 'attachment') { return mimeType; }

    return isRenderableMimeType(mimeType) ? mimeType : PLAIN_TEXT_MIME_TYPE;
}

//----------------------------------------------------------------------------------------------------------------------
