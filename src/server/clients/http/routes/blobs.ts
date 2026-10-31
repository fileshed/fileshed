//----------------------------------------------------------------------------------------------------------------------
// Blob Routes
//----------------------------------------------------------------------------------------------------------------------

import { Hono } from 'hono';

// Models
import { challengeAnswerRequestCodec, claimRequestCodec, permissionDemands } from '@fileshed/core';

// Managers
import type { BlobManager } from '../../../managers/blob.ts';
import type { SessionManager } from '../../../managers/session.ts';

// Routes
import { answerChallengeSpec, claimSpec } from './blobs.openapi.ts';
import { readJSONBody } from '../utils/readJSONBody.ts';

//----------------------------------------------------------------------------------------------------------------------

export function createBlobRoutes(sessions : SessionManager, blobs : BlobManager) : Hono
{
    const router = new Hono();

    router.post('/blobs/claim', claimSpec, async (ctx) =>
    {
        const actor = await sessions.requireActor(ctx.req.raw.headers, permissionDemands.filesWrite);

        const request = await readJSONBody(ctx, claimRequestCodec);

        return ctx.json(await blobs.claim(actor.user, request));
    });

    router.post('/blobs/claim/:challengeID', answerChallengeSpec, async (ctx) =>
    {
        const actor = await sessions.requireActor(ctx.req.raw.headers, permissionDemands.filesWrite);

        const { answer, ...metadata } = await readJSONBody(ctx, challengeAnswerRequestCodec);
        return ctx.json(await blobs.answerChallenge(actor, ctx.req.param('challengeID'), answer, metadata));
    });

    return router;
}

//----------------------------------------------------------------------------------------------------------------------
