//----------------------------------------------------------------------------------------------------------------------
// Upload Routes
//
// PUT /api/uploads/:ticket. The body is the raw byte stream, so the placement metadata the committed node needs (name,
// parentID, mimeType) rides the query string -- the one wire slot the DTO left open. The ticket authorizes the write;
// the manager verifies it belongs to the caller, streams the bytes through the store, and creates the node. Thin over
// the manager: onError maps the typed errors (managers/errors.ts).
//----------------------------------------------------------------------------------------------------------------------

import { type Context, Hono } from 'hono';

import { Readable } from 'node:stream';
import type { ReadableStream as NodeReadableStream } from 'node:stream/web';

// Models
import { BadRequestError, type UploadCommitMetadata, toNodeResponse, uploadCommitMetadataCodec } from '@fileshed/core';

// Managers
import type { BlobManager } from '../managers/blob.ts';
import type { SessionManager } from '../managers/session.ts';

//----------------------------------------------------------------------------------------------------------------------

// The commit metadata off the query string. An absent parentID is root placement (null); name and mimeType are
// required, so a missing one fails the codec into a 400 rather than a malformed node.
function readUploadMetadata(ctx : Context) : UploadCommitMetadata
{
    const parsed = uploadCommitMetadataCodec.safeParse({
        name: ctx.req.query('name'),
        parentID: ctx.req.query('parentID') ?? null,
        mimeType: ctx.req.query('mimeType'),
    });

    if(!parsed.success)
    {
        throw new BadRequestError('Invalid upload metadata: name and mimeType are required.');
    }

    return parsed.data;
}

// A declared Content-Length, when present and well-formed. A missing or malformed header is treated as absent -- the
// store still verifies the true byte count against the claimed size, so the header is only an early-reject hint.
function parseContentLength(header : string | undefined) : number | undefined
{
    if(header === undefined) { return undefined; }

    const value = Number(header);
    return Number.isInteger(value) && value >= 0 ? value : undefined;
}

//----------------------------------------------------------------------------------------------------------------------

export function createUploadRoutes(sessions : SessionManager, blobs : BlobManager) : Hono
{
    const router = new Hono();

    router.put('/:ticket', async (ctx) =>
    {
        const caller = await sessions.requireUser(ctx.req.raw.headers);

        const metadata = readUploadMetadata(ctx);
        const contentLength = parseContentLength(ctx.req.header('content-length'));

        const body = ctx.req.raw.body;
        if(body === null) { throw new BadRequestError('An upload body is required.'); }

        const node = await blobs.commitUpload(
            caller,
            ctx.req.param('ticket'),
            Readable.fromWeb(body as NodeReadableStream<Uint8Array>),
            metadata,
            contentLength
        );

        return ctx.json(toNodeResponse(node, 'owner'));
    });

    return router;
}

//----------------------------------------------------------------------------------------------------------------------
