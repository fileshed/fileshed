//----------------------------------------------------------------------------------------------------------------------
// Public Link Codec
//----------------------------------------------------------------------------------------------------------------------

import { z } from 'zod';

// Models
import type { PublicLink } from '../publicLink.ts';

// Utils
import { type Equals, typeAssert } from '../../utils/typeAssert.ts';

//----------------------------------------------------------------------------------------------------------------------

export const publicLinkCodec = z.strictObject({
    id: z.string(),
    nodeID: z.string(),
    token: z.string(),
    createdAt: z.date(),
    revokedAt: z.date().nullable(),
});

typeAssert<Equals<z.output<typeof publicLinkCodec>, PublicLink>>();

export function parsePublicLink(data : unknown) : PublicLink
{
    return publicLinkCodec.parse(data);
}

//----------------------------------------------------------------------------------------------------------------------
