//----------------------------------------------------------------------------------------------------------------------
// Admin API Codecs
//----------------------------------------------------------------------------------------------------------------------

import { z } from 'zod';

// Models
import { storageBackendKinds } from '../../storageBackend.ts';

// Requests
import type { AdminStatusResponse, SetQuotaRequest } from '../admin.ts';

// Request Schemas
import { isoDateTimeCodec } from './common.ts';

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

const wholeCount = z.number()
    .int()
    .nonnegative();

const storageBackendStatusCodec = z.strictObject({
    id: z.string(),
    kind: z.enum(storageBackendKinds),
    isDefault: z.boolean(),
});

const gcRunStatusCodec = z.strictObject({
    ranAt: isoDateTimeCodec,
    summary: z.strictObject({
        candidates: wholeCount,
        deleted: wholeCount,
        kept: wholeCount,
        bytesFailed: wholeCount,
    }),
});

const trashPurgeRunStatusCodec = z.strictObject({
    ranAt: isoDateTimeCodec,
    summary: z.strictObject({
        candidates: wholeCount,
        purged: wholeCount,
        failed: wholeCount,
    }),
});

export const adminStatusResponseCodec = z.strictObject({
    backends: z.array(storageBackendStatusCodec),
    gc: gcRunStatusCodec.nullable(),
    trashPurge: trashPurgeRunStatusCodec.nullable(),
});

typeAssert<Equals<z.output<typeof adminStatusResponseCodec>, AdminStatusResponse>>();

//----------------------------------------------------------------------------------------------------------------------
