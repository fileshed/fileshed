//----------------------------------------------------------------------------------------------------------------------
// Upload Body
//
// What a small-image upload path needs before it can trust a request: the media type off the header, and the bytes
// buffered under a hard ceiling.
//----------------------------------------------------------------------------------------------------------------------

import type { Readable } from 'node:stream';

// Models
import { PayloadTooLargeError } from '@fileshed/core';

//----------------------------------------------------------------------------------------------------------------------

// The media type off a Content-Type header, lowercased and stripped of any parameters (`image/png; charset=...`), or
// null when the header is absent. Membership in a whitelist is judged by the caller.
export function mediaType(contentType : string | undefined) : string | null
{
    if(contentType === undefined) { return null; }

    const [ media ] = contentType.split(';');
    return media === undefined ? null : media.trim().toLowerCase();
}

// Buffer the source into memory, aborting past the byte cap so an undeclared or lying Content-Length can never push
// more than the ceiling onto the heap. The callers here upload small images (a couple of MiB at most), so full
// buffering is fine and lets the bytes be hashed before they are stored.
export async function collectCapped(source : Readable, maxBytes : number, tooLarge : string) : Promise<Buffer>
{
    const chunks : Buffer[] = [];
    let seen = 0;

    for await (const chunk of source)
    {
        const buffer = chunk as Buffer;
        seen += buffer.length;
        if(seen > maxBytes)
        {
            source.destroy();
            throw new PayloadTooLargeError(tooLarge, maxBytes);
        }
        chunks.push(buffer);
    }

    return Buffer.concat(chunks);
}

//----------------------------------------------------------------------------------------------------------------------
