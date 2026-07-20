//----------------------------------------------------------------------------------------------------------------------
// Blob Routes
//
// The claim and proof-of-possession endpoints. Thin over the BlobManager: authenticate, validate the DTO, delegate. A
// malformed body or DTO is raised as a BadRequestError; every other HTTP-shaped outcome is a typed manager error.
// onError maps them all through mapManagerError (managers/errors.ts), so the routes carry no status logic of their own.
//----------------------------------------------------------------------------------------------------------------------

import { type Context, Hono } from 'hono';

// Models
import { BadRequestError, challengeAnswerRequestCodec, claimRequestCodec, toNodeResponse } from '@fileshed/core';

// Managers
import type { BlobManager } from '../managers/blob.ts';
import type { SessionManager } from '../managers/session.ts';

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

export function createBlobRoutes(sessions : SessionManager, blobs : BlobManager) : Hono
{
    const router = new Hono();

    router.post('/claim', async (ctx) =>
    {
        const caller = await sessions.requireUser(ctx.req.raw.headers);

        const parsed = claimRequestCodec.safeParse(await readJson(ctx));
        if(!parsed.success) { throw new BadRequestError('Invalid claim request.'); }

        return ctx.json(await blobs.claim(caller, parsed.data));
    });

    router.post('/claim/:challengeID', async (ctx) =>
    {
        const caller = await sessions.requireUser(ctx.req.raw.headers);

        const parsed = challengeAnswerRequestCodec.safeParse(await readJson(ctx));
        if(!parsed.success) { throw new BadRequestError('Invalid challenge answer.'); }

        const { answer, ...metadata } = parsed.data;
        const node = await blobs.answerChallenge(caller, ctx.req.param('challengeID'), answer, metadata);

        return ctx.json(toNodeResponse(node, 'owner'));
    });

    return router;
}

//----------------------------------------------------------------------------------------------------------------------
