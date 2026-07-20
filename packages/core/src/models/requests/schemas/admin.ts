//----------------------------------------------------------------------------------------------------------------------
// Admin API Codecs
//----------------------------------------------------------------------------------------------------------------------

import { z } from 'zod';

// Requests
import type { SetQuotaRequest } from '../admin.ts';

// Utils
import { type Equals, typeAssert } from '../../../utils/typeAssert.ts';

//----------------------------------------------------------------------------------------------------------------------

// A quota is a non-negative whole byte count, or null for unlimited. A negative or fractional value is not an
// under-specified request the manager can clamp -- it is a malformed one, rejected here so it never reaches a write.
export const setQuotaRequestCodec = z.strictObject({
    quotaLimit: z.number()
        .int()
        .nonnegative()
        .nullable(),
});

typeAssert<Equals<z.output<typeof setQuotaRequestCodec>, SetQuotaRequest>>();

//----------------------------------------------------------------------------------------------------------------------
