//----------------------------------------------------------------------------------------------------------------------
// Share Codec
//----------------------------------------------------------------------------------------------------------------------

import { z } from 'zod';

// Models
import type { Share } from '../share.ts';

// Schemas
import { shareRoleCodec } from './role.ts';

//----------------------------------------------------------------------------------------------------------------------

export const shareCodec = z.strictObject({
    id: z.string(),
    nodeID: z.string(),
    granteeUserID: z.string(),
    role: shareRoleCodec,
    createdBy: z.string(),
    createdAt: z.date(),
});

export function parseShare(data : unknown) : Share
{
    return shareCodec.parse(data);
}

//----------------------------------------------------------------------------------------------------------------------
