//----------------------------------------------------------------------------------------------------------------------
// Deletion Offer Codec
//----------------------------------------------------------------------------------------------------------------------

import { z } from 'zod';

// Models
import type { DeletionOffer } from '../deletionOffer.ts';

// Utils
import { type Equals, typeAssert } from '../../utils/typeAssert.ts';

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

typeAssert<Equals<z.output<typeof deletionOfferCodec>, DeletionOffer>>();

export function parseDeletionOffer(data : unknown) : DeletionOffer
{
    return deletionOfferCodec.parse(data);
}

//----------------------------------------------------------------------------------------------------------------------
