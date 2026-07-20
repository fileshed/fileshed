//----------------------------------------------------------------------------------------------------------------------
// Me API Codec
//----------------------------------------------------------------------------------------------------------------------

import { z } from 'zod';

// Models
import { userRoles } from '../../userProfile.ts';

// Requests
import type { MeResponse } from '../me.ts';

// Request Schemas
import { isoDateTimeCodec } from './common.ts';

// Utils
import { type Equals, typeAssert } from '../../../utils/typeAssert.ts';

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

typeAssert<Equals<z.output<typeof meResponseCodec>, MeResponse>>();

//----------------------------------------------------------------------------------------------------------------------
