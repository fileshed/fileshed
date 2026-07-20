//----------------------------------------------------------------------------------------------------------------------
// Deletion Offer Request/Response Codecs
//----------------------------------------------------------------------------------------------------------------------

import { z } from 'zod';

// Models
import type { DeletionOffer } from '../../deletionOffer.ts';
import type {
    AcceptDeletionOfferRequest,
    DeletionOfferListResponse,
    DeletionOfferResponse,
} from '../deletionOffers.ts';

// Schemas
import { isoDateTimeCodec } from './common.ts';

// Utils
import { type Equals, typeAssert } from '../../../utils/typeAssert.ts';

//----------------------------------------------------------------------------------------------------------------------

export const acceptDeletionOfferRequestCodec = z.strictObject({
    parentID: z.string()
        .nullable()
        .optional()
        .default(null),
    name: z.string()
        .min(1)
        .optional(),
});

typeAssert<Equals<z.output<typeof acceptDeletionOfferRequestCodec>, AcceptDeletionOfferRequest>>();

//----------------------------------------------------------------------------------------------------------------------

export const deletionOfferResponseCodec = z.strictObject({
    id: z.string(),
    sha256: z.string(),
    name: z.string(),
    mimeType: z.string(),
    size: z.number(),
    createdBy: z.string(),
    createdAt: isoDateTimeCodec,
    expiresAt: isoDateTimeCodec,
});

typeAssert<Equals<z.output<typeof deletionOfferResponseCodec>, DeletionOfferResponse>>();

export const deletionOfferListResponseCodec = z.strictObject({
    offers: z.array(deletionOfferResponseCodec),
});

typeAssert<Equals<z.output<typeof deletionOfferListResponseCodec>, DeletionOfferListResponse>>();

//----------------------------------------------------------------------------------------------------------------------

export function toDeletionOfferResponse(offer : DeletionOffer) : DeletionOfferResponse
{
    return {
        id: offer.id,
        sha256: offer.sha256,
        name: offer.name,
        mimeType: offer.mimeType,
        size: offer.size,
        createdBy: offer.createdBy,
        createdAt: offer.createdAt.toISOString(),
        expiresAt: offer.expiresAt.toISOString(),
    };
}

export function toDeletionOfferListResponse(offers : DeletionOffer[]) : DeletionOfferListResponse
{
    return { offers: offers.map(toDeletionOfferResponse) };
}

//----------------------------------------------------------------------------------------------------------------------
