//----------------------------------------------------------------------------------------------------------------------
// Admin API Codecs
//----------------------------------------------------------------------------------------------------------------------

import { z } from 'zod';

// Models
import { storageBackendKinds } from '../../storageBackend.ts';
import type { UserProfile } from '../../userProfile.ts';

// Schemas
import { userProfileCodec } from '../../schemas/userProfile.ts';

// Requests
import type { AdminStatusResponse, AdminUserPageResponse, AdminUserResponse, SetQuotaRequest } from '../admin.ts';

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

export const adminUserResponseCodec = userProfileCodec.extend({ createdAt: isoDateTimeCodec });

typeAssert<Equals<z.output<typeof adminUserResponseCodec>, AdminUserResponse>>();

export const adminUserPageResponseCodec = z.strictObject({
    users: z.array(adminUserResponseCodec),
    total: z.number()
        .int()
        .nonnegative(),
    limit: z.number()
        .int()
        .positive(),
    offset: z.number()
        .int()
        .nonnegative(),
});

typeAssert<Equals<z.output<typeof adminUserPageResponseCodec>, AdminUserPageResponse>>();

//----------------------------------------------------------------------------------------------------------------------

export function toAdminUserResponse(profile : UserProfile) : AdminUserResponse
{
    return {
        id: profile.id,
        email: profile.email,
        ...profile.name === undefined ? {} : { name: profile.name },
        role: profile.role,
        quotaLimit: profile.quotaLimit,
        createdAt: profile.createdAt.toISOString(),
    };
}

export function toAdminUserPageResponse(
    page : { users : UserProfile[]; total : number; limit : number; offset : number }
) : AdminUserPageResponse
{
    return {
        users: page.users.map(toAdminUserResponse),
        total: page.total,
        limit: page.limit,
        offset: page.offset,
    };
}

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
