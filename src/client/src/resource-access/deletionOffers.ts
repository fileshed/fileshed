//----------------------------------------------------------------------------------------------------------------------
// Deletion Offer Resource Access
//
// The typed client for the offeree's surface of the recipients-may-copy flow: list pending offers, accept one into a
// fresh owned copy (a new node), or decline it. Decline answers 204 and resolves void.
//----------------------------------------------------------------------------------------------------------------------

import {
    type AcceptDeletionOfferRequest,
    type DeletionOfferListResponse,
    type NodeResponse,
    deletionOfferListResponseCodec,
    nodeResponseCodec,
} from '@fileshed/core';

// Resource Access
import { requestJson, requestVoid } from './request.ts';

//----------------------------------------------------------------------------------------------------------------------

export async function listDeletionOffers() : Promise<DeletionOfferListResponse>
{
    return requestJson('/api/deletion-offers', { codec: deletionOfferListResponseCodec });
}

export async function acceptDeletionOffer(id : string, request : AcceptDeletionOfferRequest) : Promise<NodeResponse>
{
    return requestJson(`/api/deletion-offers/${ id }/accept`, {
        method: 'POST',
        body: request,
        codec: nodeResponseCodec,
    });
}

export async function declineDeletionOffer(id : string) : Promise<void>
{
    return requestVoid(`/api/deletion-offers/${ id }/decline`, { method: 'POST' });
}

//----------------------------------------------------------------------------------------------------------------------
