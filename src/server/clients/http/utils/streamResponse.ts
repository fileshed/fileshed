//----------------------------------------------------------------------------------------------------------------------
// Stream Responses
//----------------------------------------------------------------------------------------------------------------------

import { Readable } from 'node:stream';

// Models
import type { ContentDisposition } from '@fileshed/core';

// Managers
import type { ServedFile } from '../../../managers/publicLink.ts';

// Routes
import { ifNoneMatchHits, parseRange, strongEtag } from './byteServing.ts';
import { contentDisposition } from './contentDisposition.ts';
import { servedContentType } from './servedContentType.ts';
import { USER_CONTENT_HEADERS } from './userContentHeaders.ts';

//----------------------------------------------------------------------------------------------------------------------

export interface ByteRequest
{
    disposition : ContentDisposition;
    rangeHeader : string | undefined;
    ifNoneMatch : string | undefined;
}

//----------------------------------------------------------------------------------------------------------------------

export function streamResponse(
    status : 200 | 206 | 304 | 416,
    headers : Record<string, string>,
    stream : Readable | null
) : Response
{
    // toWeb hands back node:stream/web's ReadableStream, which IS a web stream at runtime -- the assertion only bridges
    // the duplicate lib declarations.
    const body : BodyInit | null = stream === null ? null : Readable.toWeb(stream) as BodyInit;

    return new Response(body, { status, headers: { ...USER_CONTENT_HEADERS, ...headers } });
}

// The HTTP/1.1 byte-serving contract over one file: 200 or 206, a strong ETag over the sha256, If-None-Match -> 304,
// Accept-Ranges bytes, Content-Length, Content-Range on a partial, 416 on an unsatisfiable range, and the Content-Type
// and Content-Disposition the requested disposition calls for.
export async function fileResponse(
    file : ServedFile,
    request : ByteRequest,
    extraHeaders : Record<string, string>
) : Promise<Response>
{
    const etag = strongEtag(file.sha256);

    // If-None-Match is evaluated ahead of Range (RFC 7232): a matching validator returns a bodiless 304 regardless of
    // any range.
    if(ifNoneMatchHits(request.ifNoneMatch, file.sha256))
    {
        return streamResponse(304, { 'accept-ranges': 'bytes', etag, ...extraHeaders }, null);
    }

    const plan = parseRange(request.rangeHeader, file.size);

    if(plan.kind === 'unsatisfiable')
    {
        return streamResponse(
            416,
            { 'accept-ranges': 'bytes', etag, 'content-range': `bytes */${ file.size }`, ...extraHeaders },
            null
        );
    }

    const headers = {
        'accept-ranges': 'bytes',
        'content-disposition': contentDisposition(request.disposition, file.name),
        'content-type': servedContentType(file.mimeType, request.disposition),
        etag,
        ...extraHeaders,
    };

    if(plan.kind === 'full')
    {
        return streamResponse(200, { ...headers, 'content-length': String(file.size) }, await file.open());
    }

    const { offset, length } = plan.window;
    return streamResponse(206, {
        ...headers,
        'content-length': String(length),
        'content-range': `bytes ${ offset }-${ (offset + length) - 1 }/${ file.size }`,
    }, await file.open(plan.window));
}

//----------------------------------------------------------------------------------------------------------------------
