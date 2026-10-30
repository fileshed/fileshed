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
import { readJsonBody } from '../utils/readJsonBody.ts';

//----------------------------------------------------------------------------------------------------------------------

export function createBlobRoutes(sessions : SessionManager, blobs : BlobManager) : Hono
{
    const router = new Hono();

    router.post('/blobs/claim', claimSpec, async (ctx) =>
    {
        const actor = await sessions.requireActor(ctx.req.raw.headers, permissionDemands.filesWrite);

        const request = await readJsonBody(ctx, claimRequestCodec);

        return ctx.json(await blobs.claim(actor.user, request));
    });

    router.post('/blobs/claim/:challengeID', answerChallengeSpec, async (ctx) =>
    {
        const actor = await sessions.requireActor(ctx.req.raw.headers, permissionDemands.filesWrite);

        const { answer, ...metadata } = await readJsonBody(ctx, challengeAnswerRequestCodec);
        return ctx.json(await blobs.answerChallenge(actor, ctx.req.param('challengeID'), answer, metadata));
    });

    return router;
}

//----------------------------------------------------------------------------------------------------------------------
