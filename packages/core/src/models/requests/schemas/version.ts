//----------------------------------------------------------------------------------------------------------------------
// Version API Codecs
//----------------------------------------------------------------------------------------------------------------------

import { z } from 'zod';

// Requests
import type { VersionResponse } from '../version.ts';

// Utils
import { type Equals, typeAssert } from '../../../utils/typeAssert.ts';

//----------------------------------------------------------------------------------------------------------------------

export const versionResponseCodec = z.strictObject({
    version: z.string(),
    commit: z.string().nullable(),
    branch: z.string().nullable(),
});

typeAssert<Equals<z.output<typeof versionResponseCodec>, VersionResponse>>();

//----------------------------------------------------------------------------------------------------------------------
