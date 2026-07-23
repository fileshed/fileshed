//----------------------------------------------------------------------------------------------------------------------
// Configuration
//----------------------------------------------------------------------------------------------------------------------

import { z } from 'zod';

// Constants
import {
    DEFAULT_AVATAR_MAX_BYTES,
    DEFAULT_BASE_URL,
    DEFAULT_DATABASE_PATH,
    DEFAULT_GC_GRACE_DAYS,
    DEFAULT_GC_INTERVAL_MINUTES,
    DEFAULT_HOST,
    DEFAULT_PORT,
    DEFAULT_STORAGE_ROOT,
    DEFAULT_TRASH_PURGE_DAYS,
    DEFAULT_UPLOAD_MAX_BYTES,
} from '@fileshed/core';

//----------------------------------------------------------------------------------------------------------------------

// LOG_LEVEL and NODE_ENV are deliberately absent: the logger initializes at import time, before loadConfig() can
// run, so it owns those two directly (see utils/logger.ts).
const configSchema = z.object({
    HOST: z.string().default(DEFAULT_HOST),
    PORT: z.coerce.number()
        .int()
        .positive()
        .default(DEFAULT_PORT),

    DATABASE_KIND: z.enum([ 'sqlite', 'postgres' ]).default('sqlite'),
    // DATABASE_PATH applies only to the sqlite backend; DATABASE_URL is required for postgres (enforced below).
    DATABASE_PATH: z.string().default(DEFAULT_DATABASE_PATH),
    DATABASE_URL: z.string().optional(),

    AUTH_SECRET: z.string().min(32, 'AUTH_SECRET must be at least 32 characters'),

    BASE_URL: z.url().default(DEFAULT_BASE_URL),

    // Blob storage + GC. STORAGE_ROOT is both the fs backend's root and the config the default storage_backend row is
    // seeded with. GC_GRACE_DAYS is the graveyard window before a dereferenced blob is hard-deleted; 0 collects
    // immediately (useful in tests). TRASH_PURGE_DAYS is the window a trashed item survives before the sweeper
    // permanently deletes it; 0 purges on the next sweep. UPLOAD_MAX_BYTES caps a single upload's byte count;
    // AVATAR_MAX_BYTES caps a single avatar image (charged to no quota, so it has its own, much smaller ceiling).
    STORAGE_ROOT: z.string()
        .min(1)
        .default(DEFAULT_STORAGE_ROOT),
    GC_GRACE_DAYS: z.coerce.number()
        .int()
        .nonnegative()
        .default(DEFAULT_GC_GRACE_DAYS),
    GC_INTERVAL_MINUTES: z.coerce.number()
        .int()
        .positive()
        .default(DEFAULT_GC_INTERVAL_MINUTES),
    TRASH_PURGE_DAYS: z.coerce.number()
        .int()
        .nonnegative()
        .default(DEFAULT_TRASH_PURGE_DAYS),
    UPLOAD_MAX_BYTES: z.coerce.number()
        .int()
        .positive()
        .default(DEFAULT_UPLOAD_MAX_BYTES),
    AVATAR_MAX_BYTES: z.coerce.number()
        .int()
        .positive()
        .default(DEFAULT_AVATAR_MAX_BYTES),

    // First-run admin bootstrap. Both-or-neither: setting one without the other is a misconfiguration, caught below.
    // When both are present and no user owns the email yet, boot creates the admin.
    FILESHED_ADMIN_EMAIL: z.email().optional(),
    FILESHED_ADMIN_PASSWORD: z.string().min(8, 'FILESHED_ADMIN_PASSWORD must be at least 8 characters')
        .optional(),

    // OAuth social providers are config, not code: each activates only when BOTH halves of its env pair are present.
    // Setting one half without the other is a misconfiguration, caught below (both-or-neither, like the admin pair).
    GITHUB_CLIENT_ID: z.string().optional(),
    GITHUB_CLIENT_SECRET: z.string().optional(),
    GOOGLE_CLIENT_ID: z.string().optional(),
    GOOGLE_CLIENT_SECRET: z.string().optional(),
}).superRefine((config, ctx) =>
{
    if(config.DATABASE_KIND === 'postgres' && !config.DATABASE_URL)
    {
        ctx.addIssue({
            code: 'custom',
            path: [ 'DATABASE_URL' ],
            message: 'DATABASE_URL is required when DATABASE_KIND=postgres',
        });
    }

    if(Boolean(config.FILESHED_ADMIN_EMAIL) !== Boolean(config.FILESHED_ADMIN_PASSWORD))
    {
        ctx.addIssue({
            code: 'custom',
            path: [ 'FILESHED_ADMIN_EMAIL' ],
            message: 'FILESHED_ADMIN_EMAIL and FILESHED_ADMIN_PASSWORD must be set together, or not at all',
        });
    }

    if(Boolean(config.GITHUB_CLIENT_ID) !== Boolean(config.GITHUB_CLIENT_SECRET))
    {
        ctx.addIssue({
            code: 'custom',
            path: [ 'GITHUB_CLIENT_ID' ],
            message: 'GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET must be set together, or not at all',
        });
    }

    if(Boolean(config.GOOGLE_CLIENT_ID) !== Boolean(config.GOOGLE_CLIENT_SECRET))
    {
        ctx.addIssue({
            code: 'custom',
            path: [ 'GOOGLE_CLIENT_ID' ],
            message: 'GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set together, or not at all',
        });
    }
});

export type Config = z.infer<typeof configSchema>;

//----------------------------------------------------------------------------------------------------------------------

export function loadConfig() : Config
{
    const result = configSchema.safeParse(process.env);
    if(!result.success)
    {
        throw new Error(`Invalid environment configuration:\n${ z.prettifyError(result.error) }`);
    }

    return result.data;
}

//----------------------------------------------------------------------------------------------------------------------
