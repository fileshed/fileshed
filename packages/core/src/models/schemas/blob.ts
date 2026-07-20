//----------------------------------------------------------------------------------------------------------------------
// Blob Codec
//----------------------------------------------------------------------------------------------------------------------

import { z } from 'zod';

// Models
import type { Blob } from '../blob.ts';

// Utils
import { type Equals, typeAssert } from '../../utils/typeAssert.ts';

//----------------------------------------------------------------------------------------------------------------------

export const blobCodec = z.strictObject({
    sha256: z.string(),
    size: z.number(),
    backendID: z.string(),
    storageKey: z.string(),
    createdAt: z.date(),
    deletedAt: z.date().nullable(),
});

typeAssert<Equals<z.output<typeof blobCodec>, Blob>>();

export function parseBlob(data : unknown) : Blob
{
    return blobCodec.parse(data);
}

//----------------------------------------------------------------------------------------------------------------------
