//----------------------------------------------------------------------------------------------------------------------
// Content-Disposition
//
// A non-ASCII name cannot ride the quoted `filename` parameter, so a sanitized ASCII fallback is paired with an RFC
// 5987 `filename*` carrying the real UTF-8 name percent-encoded. Quotes and backslashes are stripped from that
// fallback so they cannot break out of the quoted string, and forward slashes with them so it names a file rather
// than a path.
//----------------------------------------------------------------------------------------------------------------------

// Models
import type { ContentDisposition } from '@fileshed/core';

//----------------------------------------------------------------------------------------------------------------------

const NON_ASCII = /[^\x20-\x7e]/u;
const NON_ASCII_GLOBAL = /[^\x20-\x7e]/gu;

//----------------------------------------------------------------------------------------------------------------------

export function contentDisposition(disposition : ContentDisposition, filename : string) : string
{
    const asciiFallback = filename
        .replace(NON_ASCII_GLOBAL, '_')
        .replace(/["\\/]/gu, '_');

    if(NON_ASCII.test(filename))
    {
        return `${ disposition }; filename="${ asciiFallback }"; filename*=UTF-8''${ encodeURIComponent(filename) }`;
    }

    return `${ disposition }; filename="${ asciiFallback }"`;
}

//----------------------------------------------------------------------------------------------------------------------
