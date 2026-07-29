//----------------------------------------------------------------------------------------------------------------------
// Admin API Codecs
//----------------------------------------------------------------------------------------------------------------------

import { z } from 'zod';

// Models
import { storageBackendKinds } from '../../storageBackend.ts';
import { type UserProfile, userRoles } from '../../userProfile.ts';

// Schemas
import { userProfileCodec } from '../../schemas/userProfile.ts';

// Requests
import type {
    AdminStatusResponse,
    AdminUserPageResponse,
    AdminUserResponse,
    BanUserRequest,
    SetPasswordRequest,
    SetQuotaRequest,
    SetRoleRequest,
} from '../admin.ts';

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

// A ban expiry is whole days, 1..365 -- longer bans are the no-expiry kind, lifted by hand. The reason is optional
// and capped to keep it a note, not an essay.
export const banUserRequestCodec = z.strictObject({
    reason: z.string()
        .trim()
        .min(1)
        .max(500)
        .optional(),
    expiresInDays: z.number()
        .int()
        .min(1)
        .max(365)
        .optional(),
});

typeAssert<Equals<z.output<typeof banUserRequestCodec>, BanUserRequest>>();

export const setRoleRequestCodec = z.strictObject({
    role: z.enum(userRoles),
});

typeAssert<Equals<z.output<typeof setRoleRequestCodec>, SetRoleRequest>>();

// The password floor matches better-auth's own sign-up minimum.
export const setPasswordRequestCodec = z.strictObject({
    password: z.string().min(8),
});

typeAssert<Equals<z.output<typeof setPasswordRequestCodec>, SetPasswordRequest>>();

//----------------------------------------------------------------------------------------------------------------------

export const adminUserResponseCodec = userProfileCodec.extend({
    banExpires: isoDateTimeCodec.nullable(),
    usedBytes: z.number()
        .int()
        .nonnegative(),
    createdAt: isoDateTimeCodec,
});

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

export function toAdminUserResponse(entry : { profile : UserProfile; usedBytes : number }) : AdminUserResponse
{
    const { profile, usedBytes } = entry;

    return {
        id: profile.id,
        email: profile.email,
        ...profile.name === undefined ? {} : { name: profile.name },
        role: profile.role,
        quotaLimit: profile.quotaLimit,
        banned: profile.banned,
        banReason: profile.banReason,
        banExpires: profile.banExpires === null ? null : profile.banExpires.toISOString(),
        usedBytes,
        createdAt: profile.createdAt.toISOString(),
    };
}

export function toAdminUserPageResponse(
    page : {
        users : { profile : UserProfile; usedBytes : number }[];
        total : number;
        limit : number;
        offset : number;
    }
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
