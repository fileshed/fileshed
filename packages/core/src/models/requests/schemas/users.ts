//----------------------------------------------------------------------------------------------------------------------
// User Lookup API Codec
//----------------------------------------------------------------------------------------------------------------------

import { z } from 'zod';

// Requests
import type { UserLookupQuery } from '../users.ts';

// Utils
import { type Equals, typeAssert } from '../../../utils/typeAssert.ts';

//----------------------------------------------------------------------------------------------------------------------

// email is trimmed then required non-empty, so a blank or whitespace-only query is a 400 rather than a table scan. The
// value is matched case-insensitively at the resource-access layer, not normalized here -- the wire shape stays what
// the caller typed.
export const userLookupQueryCodec = z.strictObject({
    email: z.string()
        .trim()
        .min(1),
});

typeAssert<Equals<z.output<typeof userLookupQueryCodec>, UserLookupQuery>>();

//----------------------------------------------------------------------------------------------------------------------
