//----------------------------------------------------------------------------------------------------------------------
// Stream Response Adapter
//
// Turns the manager's StreamResult into an HTTP Response for the direct-link and download routes. The body is a Node
// Readable for 200/206 -- adapted to a web ReadableStream so bytes flow without buffering -- and null for the bodiless
// 304/416. Both byte-serving routes share this so the status/header set lives in one place.
//----------------------------------------------------------------------------------------------------------------------

import { Readable } from 'node:stream';

// Managers
import type { StreamResult } from '../managers/publicLink.ts';

//----------------------------------------------------------------------------------------------------------------------

export function streamResponse(result : StreamResult) : Response
{
    // toWeb hands back node:stream/web's ReadableStream, which IS a web stream at runtime -- the assertion only bridges
    // the duplicate lib declarations.
    const body : BodyInit | null = result.stream === null ? null : Readable.toWeb(result.stream) as BodyInit;

    return new Response(body, { status: result.status, headers: result.headers });
}

//----------------------------------------------------------------------------------------------------------------------
