//----------------------------------------------------------------------------------------------------------------------
// Blob Routes
//
// The claim and proof-of-possession endpoints. Thin over the BlobManager: authenticate, validate the DTO, delegate. A
// malformed body or DTO is raised as a BadRequestError; every other HTTP-shaped outcome is a typed manager error.
// onError maps them all through mapManagerError (managers/errors.ts), so the routes carry no status logic of their own.
//----------------------------------------------------------------------------------------------------------------------

import { type Context, Hono } from 'hono';

// Models
import {
    BadRequestError,
    challengeAnswerRequestCodec,
    claimRequestCodec,
    permissionDemands,
    toNodeResponse,
} from '@fileshed/core';

// Managers
import type { BlobManager } from '../managers/blob.ts';
import type { MediaTagManager } from '../managers/mediaTags.ts';
import type { SessionManager } from '../managers/session.ts';

// Routes
import { answerChallengeSpec, claimSpec } from './blobs.openapi.ts';

//----------------------------------------------------------------------------------------------------------------------

// A JSON body, or a BadRequestError -- ctx.req.json throws a SyntaxError on malformed input, which would otherwise fall
// through to a 500 rather than the 400 a bad request deserves.
async function readJson(ctx : Context) : Promise<unknown>
{
    try
    {
        return await ctx.req.json();
    }
    catch
    {
        throw new BadRequestError('Request body must be valid JSON.');
    }
}

//----------------------------------------------------------------------------------------------------------------------

export function createBlobRoutes(sessions : SessionManager, blobs : BlobManager, tags : MediaTagManager) : Hono
{
    const router = new Hono();

    router.post('/blobs/claim', claimSpec, async (ctx) =>
    {
        const caller = await sessions.requireActor(ctx.req.raw.headers, permissionDemands.filesWrite);

        const parsed = claimRequestCodec.safeParse(await readJson(ctx));
        if(!parsed.success) { throw new BadRequestError('Invalid claim request.'); }

        return ctx.json(await blobs.claim(caller.user, parsed.data));
    });

    router.post('/blobs/claim/:challengeID', answerChallengeSpec, async (ctx) =>
    {
        const caller = await sessions.requireActor(ctx.req.raw.headers, permissionDemands.filesWrite);

        const parsed = challengeAnswerRequestCodec.safeParse(await readJson(ctx));
        if(!parsed.success) { throw new BadRequestError('Invalid challenge answer.'); }

        const { answer, ...metadata } = parsed.data;
        const { node, role } = await blobs.answerChallenge(caller.user, ctx.req.param('challengeID'), answer, metadata);

        // A dedup claim usually lands on an already-extracted blob; ensureFor's existence check makes this a no-op
        // then, and covers the first-claim-after-resurrection case when it is not.
        if(node.type === 'file') { tags.enrichInBackground(node.blobID, node.mimeType); }

        return ctx.json(toNodeResponse(node, role));
    });

    return router;
}

//----------------------------------------------------------------------------------------------------------------------
