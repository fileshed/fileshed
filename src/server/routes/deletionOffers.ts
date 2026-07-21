//----------------------------------------------------------------------------------------------------------------------
// Deletion Offer Routes
//
// The offeree's surface: list pending offers, accept one into an owned copy, decline one. Every handler resolves the
// caller through the session manager (401 when absent); ownership of an offer, expiry, and quota are the manager's,
// bubbling as typed errors that onError maps.
//----------------------------------------------------------------------------------------------------------------------

import { Hono } from 'hono';

// Models
import { acceptDeletionOfferRequestCodec } from '@fileshed/core';

// Managers
import type { DeletionOfferManager } from '../managers/deletionOffer.ts';
import type { SessionManager } from '../managers/session.ts';

// Routes
import {
    acceptDeletionOfferSpec,
    declineDeletionOfferSpec,
    listDeletionOffersSpec,
} from './deletionOffers.openapi.ts';
import { readJsonBody } from './readJsonBody.ts';

//----------------------------------------------------------------------------------------------------------------------

export function createDeletionOfferRoutes(sessions : SessionManager, offers : DeletionOfferManager) : Hono
{
    const router = new Hono();

    router.get('/deletion-offers', listDeletionOffersSpec, async (ctx) =>
    {
        const actor = await sessions.requireUser(ctx.req.raw.headers);

        return ctx.json(await offers.list(actor));
    });

    router.post('/deletion-offers/:id/accept', acceptDeletionOfferSpec, async (ctx) =>
    {
        const actor = await sessions.requireUser(ctx.req.raw.headers);
        const request = await readJsonBody(ctx, acceptDeletionOfferRequestCodec);

        return ctx.json(await offers.accept(actor, ctx.req.param('id'), request), 201);
    });

    router.post('/deletion-offers/:id/decline', declineDeletionOfferSpec, async (ctx) =>
    {
        const actor = await sessions.requireUser(ctx.req.raw.headers);
        await offers.decline(actor, ctx.req.param('id'));

        return ctx.body(null, 204);
    });

    return router;
}

//----------------------------------------------------------------------------------------------------------------------
