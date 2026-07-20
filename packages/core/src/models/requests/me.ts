//----------------------------------------------------------------------------------------------------------------------
// Me API DTO
//
// Response contract for GET /api/me (requirements.md sec 7): the caller's own profile plus quota usage. limit mirrors
// UserProfile.quotaLimit (null = unlimited, sec 5); used is the live charged-usage aggregate (sec 5), computed fresh
// per request.
//----------------------------------------------------------------------------------------------------------------------

import { z } from 'zod';

// Models
import { userRoles } from '../userProfile.ts';

// Requests
import { isoDateTimeCodec } from './common.ts';

//----------------------------------------------------------------------------------------------------------------------

export const meResponseCodec = z.strictObject({
    id: z.string(),
    email: z.string(),
    name: z.string().optional(),
    role: z.enum(userRoles),
    quota: z.strictObject({
        used: z.number()
            .int()
            .nonnegative(),
        limit: z.number()
            .int()
            .nonnegative()
            .nullable(),
    }),
    createdAt: isoDateTimeCodec,
});

export type MeResponse = z.infer<typeof meResponseCodec>;

//----------------------------------------------------------------------------------------------------------------------
