//----------------------------------------------------------------------------------------------------------------------
// User Profile Codec
//----------------------------------------------------------------------------------------------------------------------

import { z } from 'zod';

// Models
import { type UserProfile, userRoles } from '../userProfile.ts';

// Utils
import { type Equals, typeAssert } from '../../utils/typeAssert.ts';

//----------------------------------------------------------------------------------------------------------------------

export const userProfileCodec = z.strictObject({
    id: z.string(),
    email: z.string(),
    name: z.string().optional(),
    role: z.enum(userRoles),
    quotaLimit: z.number().nullable(),
    banned: z.boolean(),
    banReason: z.string().nullable(),
    banExpires: z.date().nullable(),
    createdAt: z.date(),
});

typeAssert<Equals<z.output<typeof userProfileCodec>, UserProfile>>();

export function parseUserProfile(data : unknown) : UserProfile
{
    return userProfileCodec.parse(data);
}

//----------------------------------------------------------------------------------------------------------------------
