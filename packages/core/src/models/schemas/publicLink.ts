//----------------------------------------------------------------------------------------------------------------------
// Public Link Codec
//----------------------------------------------------------------------------------------------------------------------

import { z } from 'zod';

// Models
import { type PublicLink, publicLinkDispositions, publicLinkModes } from '../publicLink.ts';

//----------------------------------------------------------------------------------------------------------------------

export const publicLinkCodec = z.strictObject({
    id: z.string(),
    nodeID: z.string(),
    token: z.string(),
    mode: z.enum(publicLinkModes),
    disposition: z.enum(publicLinkDispositions),
    createdAt: z.date(),
    revokedAt: z.date().nullable(),
});

export function parsePublicLink(data : unknown) : PublicLink
{
    return publicLinkCodec.parse(data);
}

//----------------------------------------------------------------------------------------------------------------------
