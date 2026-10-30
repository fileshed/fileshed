//----------------------------------------------------------------------------------------------------------------------
// Upload Routes
//
// The body is the raw byte stream, so the commit metadata rides the query string.
//----------------------------------------------------------------------------------------------------------------------

import { type Context, Hono } from 'hono';

// Models
import {
    BadRequestError,
    type UploadCommitMetadata,
    permissionDemands,
    uploadCommitMetadataCodec,
} from '@fileshed/core';

// Managers
import type { BlobManager } from '../../../managers/blob.ts';
import type { SessionManager } from '../../../managers/session.ts';

// Routes
import { readByteBody } from '../utils/readByteBody.ts';
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

// Where in the file this body's bytes belong. An absent offset is the start, so a client with nothing to chunk sends
// the request it always did. A malformed one is refused rather than defaulted -- guessing an offset writes bytes
// somewhere nobody asked for.
function readOffset(ctx : Context) : number
{
    const raw = ctx.req.query('offset');
    if(raw === undefined) { return 0; }

    const value = Number(raw);
    if(!Number.isInteger(value) || value < 0)
    {
        throw new BadRequestError('The chunk offset must be a non-negative integer.');
    }

    return value;
}

//----------------------------------------------------------------------------------------------------------------------

export function createUploadRoutes(sessions : SessionManager, blobs : BlobManager) : Hono
{
    const router = new Hono();

    router.put('/uploads/:ticket', uploadSpec, async (ctx) =>
    {
        const actor = await sessions.requireActor(ctx.req.raw.headers, permissionDemands.filesWrite);

        const metadata = readUploadMetadata(ctx);
        const offset = readOffset(ctx);
        const body = readByteBody(ctx, 'An upload body is required.');

        const outcome = await blobs.commitUpload(actor, ctx.req.param('ticket'), { ...body, offset }, metadata);

        if(!outcome.committed)
        {
            return ctx.json({ receivedBytes: outcome.receivedBytes, totalBytes: outcome.totalBytes }, 202);
        }

        return ctx.json(outcome.node);
    });

    return router;
}

//----------------------------------------------------------------------------------------------------------------------
