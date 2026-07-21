//----------------------------------------------------------------------------------------------------------------------
// Deletion Offer Route OpenAPI Specs
//----------------------------------------------------------------------------------------------------------------------

import { describeRoute } from 'hono-openapi';

// Models
import { acceptDeletionOfferRequestCodec, deletionOfferListResponseCodec, nodeResponseCodec } from '@fileshed/core';

// Routes
import { emptyResponse, errorResponse, jsonBody, jsonResponse, pathParam } from './docSchema.ts';

//----------------------------------------------------------------------------------------------------------------------

const OFFER_TAG = 'Deletion Offers';

const offerIDParam = pathParam('id', 'The deletion offer ID.');

//----------------------------------------------------------------------------------------------------------------------

export const listDeletionOffersSpec = describeRoute({
    tags: [ OFFER_TAG ],
    summary: 'List deletion offers',
    description: 'The caller\'s pending, unexpired offers -- save-a-copy invitations minted when an owner deleted a '
        + 'file the caller could reach through a share.',
    responses: {
        200: jsonResponse('The caller\'s pending offers.', deletionOfferListResponseCodec),
        401: errorResponse('No session.'),
    },
});

export const acceptDeletionOfferSpec = describeRoute({
    tags: [ OFFER_TAG ],
    summary: 'Accept a deletion offer',
    description: 'Materializes the offer\'s snapshot into a new file node the caller owns, charged to their quota, '
        + 'resurrecting the blob and consuming the offer in one transaction. An offer that vanished underneath the '
        + 'accept is absent; a quota rejection rolls the whole thing back so the caller can free space and retry.',
    parameters: [ offerIDParam ],
    requestBody: jsonBody(acceptDeletionOfferRequestCodec),
    responses: {
        201: jsonResponse('The materialized file node.', nodeResponseCodec),
        400: errorResponse('The request body does not match the expected shape.'),
        401: errorResponse('No session.'),
        403: errorResponse('The write would exceed the caller\'s quota, or the destination parent is forbidden.'),
        404: errorResponse('No such offer, or the destination parent does not exist.'),
        422: errorResponse('The parent placement violates a rule.'),
    },
});

export const declineDeletionOfferSpec = describeRoute({
    tags: [ OFFER_TAG ],
    summary: 'Decline a deletion offer',
    description: 'Discards one of the caller\'s pending offers.',
    parameters: [ offerIDParam ],
    responses: {
        204: emptyResponse('The offer was declined.'),
        401: errorResponse('No session.'),
        404: errorResponse('No such offer.'),
    },
});

//----------------------------------------------------------------------------------------------------------------------
