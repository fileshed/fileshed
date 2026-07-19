//----------------------------------------------------------------------------------------------------------------------
// User Profile Codec
//----------------------------------------------------------------------------------------------------------------------

import { z } from 'zod';

// Models
import type { UserProfile } from '../userProfile.ts';

//----------------------------------------------------------------------------------------------------------------------

export const userProfileCodec = z.strictObject({
    id: z.string(),
    email: z.string(),
    name: z.string().optional(),
    role: z.enum([ 'admin', 'user' ]),
    quotaLimit: z.number().nullable(),
    createdAt: z.date(),
});

export function parseUserProfile(data : unknown) : UserProfile
{
    return userProfileCodec.parse(data);
}

//----------------------------------------------------------------------------------------------------------------------
