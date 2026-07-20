//----------------------------------------------------------------------------------------------------------------------
// Storage Backend Codec
//----------------------------------------------------------------------------------------------------------------------

import { z } from 'zod';

// Models
import { type StorageBackend, storageBackendKinds } from '../storageBackend.ts';

// Utils
import { type Equals, typeAssert } from '../../utils/typeAssert.ts';

//----------------------------------------------------------------------------------------------------------------------

export const storageBackendCodec = z.strictObject({
    id: z.string(),
    kind: z.enum(storageBackendKinds),
    config: z.record(z.string(), z.unknown()),
    isDefault: z.boolean(),
});

typeAssert<Equals<z.output<typeof storageBackendCodec>, StorageBackend>>();

export function parseStorageBackend(data : unknown) : StorageBackend
{
    return storageBackendCodec.parse(data);
}

//----------------------------------------------------------------------------------------------------------------------
