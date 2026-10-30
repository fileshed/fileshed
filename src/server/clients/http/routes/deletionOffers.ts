//----------------------------------------------------------------------------------------------------------------------
// Deletion Offer Routes
//----------------------------------------------------------------------------------------------------------------------

import { Hono } from 'hono';

// Models
import { acceptDeletionOfferRequestCodec, permissionDemands } from '@fileshed/core';

// Managers
import type { DeletionOfferManager } from '../../../managers/deletionOffer.ts';
import type { SessionManager } from '../../../managers/session.ts';

// Routes
import {
    acceptDeletionOfferSpec,
    declineDeletionOfferSpec,
    listDeletionOffersSpec,
} from './deletionOffers.openapi.ts';
import { readJSONBody } from '../utils/readJSONBody.ts';

//----------------------------------------------------------------------------------------------------------------------

export function createDeletionOfferRoutes(sessions : SessionManager, offers : DeletionOfferManager) : Hono
{
    const router = new Hono();

    router.get('/deletion-offers', listDeletionOffersSpec, async (ctx) =>
    {
        const actor = await sessions.requireActor(ctx.req.raw.headers, permissionDemands.filesRead);

        return ctx.json(await offers.list(actor.user));
    });

    router.post('/deletion-offers/:id/accept', acceptDeletionOfferSpec, async (ctx) =>
    {
        const actor = await sessions.requireActor(ctx.req.raw.headers, permissionDemands.filesWrite);
        const request = await readJSONBody(ctx, acceptDeletionOfferRequestCodec);

        return ctx.json(await offers.accept(actor.user, ctx.req.param('id'), request), 201);
    });

    router.post('/deletion-offers/:id/decline', declineDeletionOfferSpec, async (ctx) =>
    {
        const actor = await sessions.requireActor(ctx.req.raw.headers, permissionDemands.filesWrite);
        await offers.decline(actor.user, ctx.req.param('id'));

        return ctx.body(null, 204);
    });

    return router;
}

//----------------------------------------------------------------------------------------------------------------------
