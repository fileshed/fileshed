//----------------------------------------------------------------------------------------------------------------------
// Admin API Codecs
//----------------------------------------------------------------------------------------------------------------------

import { z } from 'zod';

// Constants
import { BAN_MAX_EXPIRES_DAYS, BAN_REASON_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '../../../constants/user.ts';

// Models
import { databaseKinds } from '../../database.ts';
import { storageBackendKinds } from '../../storageBackend.ts';
import { userRoles } from '../../userProfile.ts';

// Schemas
import { userProfileCodec } from '../../schemas/userProfile.ts';

// Requests
import type {
    AdminOverview,
    AdminStatusResponse,
    AdminUserEntry,
    AdminUserPage,
    AdminUserPageResponse,
    AdminUserResponse,
    BanUserRequest,
    SetPasswordRequest,
    SetQuotaRequest,
    SetRoleRequest,
    TestEmailResponse,
} from '../admin.ts';

// Request Schemas
import { isoDateTimeCodec } from './common.ts';

// Utils
import { type Equals, typeAssert } from '../../../utils/typeAssert.ts';

//----------------------------------------------------------------------------------------------------------------------

// A quota is a non-negative whole byte count -- 0 spelling unlimited -- or null to inherit the instance default. A
// negative or fractional value is not an under-specified request the manager can clamp: it is a malformed one,
// rejected here so it never reaches a write.
export const setQuotaRequestCodec = z.strictObject({
    quotaLimit: z.number()
        .int()
        .nonnegative()
        .nullable(),
});

typeAssert<Equals<z.output<typeof setQuotaRequestCodec>, SetQuotaRequest>>();

//----------------------------------------------------------------------------------------------------------------------

// A ban expiry is whole days -- longer bans are the no-expiry kind, lifted by hand. The reason is optional.
export const banUserRequestCodec = z.strictObject({
    reason: z.string()
        .trim()
        .min(1)
        .max(BAN_REASON_MAX_LENGTH)
        .optional(),
    expiresInDays: z.number()
        .int()
        .min(1)
        .max(BAN_MAX_EXPIRES_DAYS)
        .optional(),
});

typeAssert<Equals<z.output<typeof banUserRequestCodec>, BanUserRequest>>();

export const setRoleRequestCodec = z.strictObject({
    role: z.enum(userRoles),
});

typeAssert<Equals<z.output<typeof setRoleRequestCodec>, SetRoleRequest>>();

export const setPasswordRequestCodec = z.strictObject({
    password: z.string().min(PASSWORD_MIN_LENGTH),
});

typeAssert<Equals<z.output<typeof setPasswordRequestCodec>, SetPasswordRequest>>();

export const testEmailResponseCodec = z.strictObject({
    to: z.string(),
});

typeAssert<Equals<z.output<typeof testEmailResponseCodec>, TestEmailResponse>>();

//----------------------------------------------------------------------------------------------------------------------

export const adminUserResponseCodec = userProfileCodec.extend({
    // Resolved, never raw: 0 is not an effective quota, it is the raw column's way of spelling the null below.
    quotaEffective: z.number()
        .int()
        .positive()
        .nullable(),
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

export function toAdminUserResponse(entry : AdminUserEntry) : AdminUserResponse
{
    const { profile, quotaEffective, usedBytes } = entry;

    return {
        id: profile.id,
        email: profile.email,
        ...profile.name === undefined ? {} : { name: profile.name },
        role: profile.role,
        quotaLimit: profile.quotaLimit,
        quotaEffective,
        banned: profile.banned,
        banReason: profile.banReason,
        banExpires: profile.banExpires === null ? null : profile.banExpires.toISOString(),
        usedBytes,
        createdAt: profile.createdAt.toISOString(),
    };
}

export function toAdminUserPageResponse(page : AdminUserPage) : AdminUserPageResponse
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

const adminOverviewCodec = z.strictObject({
    users: z.strictObject({
        total: wholeCount,
        admins: wholeCount,
        banned: wholeCount,
        newThisWeek: wholeCount,
    }),
    nodes: z.strictObject({
        files: wholeCount,
        folders: wholeCount,
    }),
    storage: z.strictObject({
        logicalBytes: wholeCount,
        physicalBytes: wholeCount,
        graveyardBytes: wholeCount,
        graveyardCount: wholeCount,
    }),
    trash: z.strictObject({
        count: wholeCount,
        bytes: wholeCount,
    }),
    accessRequestsPending: wholeCount,
    instance: z.strictObject({
        version: z.string(),
        databaseKind: z.enum(databaseKinds),
        uptimeSeconds: wholeCount,
        emailEnabled: z.boolean(),
        activeProviders: wholeCount,
        signUpEnabled: z.boolean(),
    }),
});

typeAssert<Equals<z.output<typeof adminOverviewCodec>, AdminOverview>>();

export const adminStatusResponseCodec = z.strictObject({
    overview: adminOverviewCodec,
    backends: z.array(storageBackendStatusCodec),
    gc: gcRunStatusCodec.nullable(),
    trashPurge: trashPurgeRunStatusCodec.nullable(),
});

typeAssert<Equals<z.output<typeof adminStatusResponseCodec>, AdminStatusResponse>>();

//----------------------------------------------------------------------------------------------------------------------
