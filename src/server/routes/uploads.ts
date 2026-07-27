//----------------------------------------------------------------------------------------------------------------------
// Upload Routes
//
// PUT /api/uploads/:ticket. The body is the raw byte stream, so the commit metadata rides the query string -- the one
// wire slot the DTO left open. Either the new-node placement (name, parentID, mimeType) OR a replaceNodeID to overwrite
// an existing file's content in place; the two modes are mutually exclusive at the codec. The ticket authorizes the
// write; the manager verifies it belongs to the caller, streams the bytes through the store, and commits the node. Thin
// over the manager: onError maps the typed errors (managers/errors.ts).
//----------------------------------------------------------------------------------------------------------------------

import { type Context, Hono } from 'hono';

import { Readable } from 'node:stream';
import type { ReadableStream as NodeReadableStream } from 'node:stream/web';

// Models
import {
    BadRequestError,
    type UploadCommitMetadata,
    permissionDemands,
    toNodeResponse,
    uploadCommitMetadataCodec,
} from '@fileshed/core';

// Managers
import type { BlobManager } from '../managers/blob.ts';
import type { SessionManager } from '../managers/session.ts';

// Routes
import { uploadSpec } from './uploads.openapi.ts';

//----------------------------------------------------------------------------------------------------------------------

// The commit metadata off the query string. Only the params actually present are handed to the codec, so its two
// mutually exclusive modes stay honest: a create carries name/parentID/mimeType, a replace carries replaceNodeID (and
// an optional mimeType). Passing an absent param as undefined would trip the strict-object check of whichever mode it
// does not belong to; omitting it lets an absent parentID default to root and lets the codec discriminate cleanly.
function readUploadMetadata(ctx : Context) : UploadCommitMetadata
{
    const raw : Record<string, string> = {};
    for(const key of [ 'name', 'parentID', 'mimeType', 'replaceNodeID', 'ifBlobID' ] as const)
    {
        const value = ctx.req.query(key);
        if(value !== undefined) { raw[key] = value; }
    }

    const parsed = uploadCommitMetadataCodec.safeParse(raw);
    if(!parsed.success)
    {
        throw new BadRequestError(
            'Invalid upload metadata: provide name and mimeType for a new file, or replaceNodeID to replace one.'
        );
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

    router.put('/uploads/:ticket', uploadSpec, async (ctx) =>
    {
        const caller = await sessions.requireActor(ctx.req.raw.headers, permissionDemands.filesWrite);

        const metadata = readUploadMetadata(ctx);
        const contentLength = parseContentLength(ctx.req.header('content-length'));

        const body = ctx.req.raw.body;
        if(body === null) { throw new BadRequestError('An upload body is required.'); }

        const { node, role } = await blobs.commitUpload(
            caller.user,
            ctx.req.param('ticket'),
            Readable.fromWeb(body as NodeReadableStream<Uint8Array>),
            metadata,
            contentLength
        );

        return ctx.json(toNodeResponse(node, role));
    });

    return router;
}

//----------------------------------------------------------------------------------------------------------------------
