//----------------------------------------------------------------------------------------------------------------------
// Deletion Offer Resource Access
//----------------------------------------------------------------------------------------------------------------------

import {
    type AcceptDeletionOfferRequest,
    type DeletionOfferListResponse,
    type NodeResponse,
    deletionOfferListResponseCodec,
    nodeResponseCodec,
} from '@fileshed/core';

// Resource Access
import { requestJSON, requestVoid } from './request.ts';

//----------------------------------------------------------------------------------------------------------------------

export async function listDeletionOffers() : Promise<DeletionOfferListResponse>
{
    return requestJSON('/api/deletion-offers', { codec: deletionOfferListResponseCodec });
}

export async function acceptDeletionOffer(id : string, request : AcceptDeletionOfferRequest) : Promise<NodeResponse>
{
    return requestJSON(`/api/deletion-offers/${ id }/accept`, {
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
