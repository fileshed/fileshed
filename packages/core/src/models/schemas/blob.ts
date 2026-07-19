//----------------------------------------------------------------------------------------------------------------------
// Blob Codec
//----------------------------------------------------------------------------------------------------------------------

import { z } from 'zod';

// Models
import type { Blob } from '../blob.ts';

//----------------------------------------------------------------------------------------------------------------------

export const blobCodec = z.strictObject({
    sha256: z.string(),
    size: z.number(),
    backendID: z.string(),
    storageKey: z.string(),
    createdAt: z.date(),
    deletedAt: z.date().nullable(),
});

export function parseBlob(data : unknown) : Blob
{
    return blobCodec.parse(data);
}

//----------------------------------------------------------------------------------------------------------------------
