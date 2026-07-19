//----------------------------------------------------------------------------------------------------------------------
// Deletion Offer Codec
//----------------------------------------------------------------------------------------------------------------------

import { z } from 'zod';

// Models
import type { DeletionOffer } from '../deletionOffer.ts';

//----------------------------------------------------------------------------------------------------------------------

export const deletionOfferCodec = z.strictObject({
    id: z.string(),
    sha256: z.string(),
    offereeID: z.string(),
    name: z.string(),
    mimeType: z.string(),
    size: z.number(),
    createdBy: z.string(),
    createdAt: z.date(),
    expiresAt: z.date(),
});

export function parseDeletionOffer(data : unknown) : DeletionOffer
{
    return deletionOfferCodec.parse(data);
}

//----------------------------------------------------------------------------------------------------------------------
