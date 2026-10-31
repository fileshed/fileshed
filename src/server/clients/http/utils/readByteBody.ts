//----------------------------------------------------------------------------------------------------------------------
// Byte Body Reader
//
// The declared length is only an early-reject hint: the store counts what actually arrives, so a missing or malformed
// header reads as absent rather than failing the request.
//----------------------------------------------------------------------------------------------------------------------

import type { Context } from 'hono';

import { Readable } from 'node:stream';
import type { ReadableStream as NodeReadableStream } from 'node:stream/web';

// Models
import { BadRequestError } from '@fileshed/core';

//----------------------------------------------------------------------------------------------------------------------

export interface ByteBody
{
    stream : Readable;
    contentLength : number | undefined;

    // Off the Content-Type header, lowercased and stripped of parameters (`image/png; charset=...`), or null when the
    // header is absent. Whether it is acceptable is the manager's call.
    mediaType : string | null;
}

function parseContentLength(header : string | undefined) : number | undefined
{
    if(header === undefined) { return undefined; }

    const value = Number(header);
    return Number.isInteger(value) && value >= 0 ? value : undefined;
}

function parseMediaType(header : string | undefined) : string | null
{
    if(header === undefined) { return null; }

    const [ media ] = header.split(';');
    return media === undefined ? null : media.trim().toLowerCase();
}

// `missing` is the refusal for a request with no body at all, worded for what the route expected to receive.
export function readByteBody(ctx : Context, missing : string) : ByteBody
{
    const body = ctx.req.raw.body;
    if(body === null) { throw new BadRequestError(missing); }

    return {
        stream: Readable.fromWeb(body as NodeReadableStream<Uint8Array>),
        contentLength: parseContentLength(ctx.req.header('content-length')),
        mediaType: parseMediaType(ctx.req.header('content-type')),
    };
}

//----------------------------------------------------------------------------------------------------------------------
