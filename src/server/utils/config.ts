//----------------------------------------------------------------------------------------------------------------------
// Configuration
//
// The committed config.yaml IS the defaults: its values carry ${VAR} / ${VAR:-fallback} substitutions resolved
// against the process environment at load, so an environment variable set at deployment and a fallback written in
// the file are indistinguishable downstream -- one substituted, parsed object, validated by the schema below.
// Admin-set database overrides layer ABOVE the loaded config at runtime (the settings manager's job, not this
// file's). An empty substitution result reads as unset, exactly like an absent environment variable.
//----------------------------------------------------------------------------------------------------------------------

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { parse as parseYaml } from 'yaml';
import { z } from 'zod';

// Models
import {
    DEFAULT_AVATAR_MAX_BYTES,
    DEFAULT_BASE_URL,
    DEFAULT_DATABASE_PATH,
    DEFAULT_GC_GRACE_DAYS,
    DEFAULT_GC_INTERVAL_MINUTES,
    DEFAULT_HOST,
    DEFAULT_PORT,
    DEFAULT_SMTP_PORT,
    DEFAULT_STORAGE_ROOT,
    DEFAULT_TRASH_PURGE_DAYS,
    DEFAULT_UPLOAD_MAX_BYTES,
    type ProviderSettingKey,
    databaseKinds,
    providerSettingKeys,
} from '@fileshed/core';

//----------------------------------------------------------------------------------------------------------------------

// One optional string per provider setting key, generated so the schema tracks the provider vocabulary instead of
// hand-listing seventy keys.
const providerConfigShape = Object.fromEntries(
    providerSettingKeys.map((key) => [ key, z.string().optional() ])
) as Record<ProviderSettingKey, z.ZodOptional<z.ZodString>>;

// Boolean-ish yaml/env values, honestly: the substitution is textual, so yaml hands us real booleans for bare
// true/false but strings for anything else -- and z.coerce.boolean would read the STRING "no" as true. Map the
// common negative spellings explicitly; everything else follows plain truthiness.
const booleanish = z.preprocess((value) =>
{
    if(typeof value === 'string') { return ![ 'false', 'no', 'off', '0', '' ].includes(value.toLowerCase()); }

    return Boolean(value);
}, z.boolean());

// LOG_LEVEL and NODE_ENV are deliberately absent: the logger initializes at import time, before loadConfig() can
// run, so it owns those two directly (see utils/logger.ts).
const configSchema = z.object({
    HOST: z.string().default(DEFAULT_HOST),
    PORT: z.coerce.number()
        .int()
        .positive()
        .default(DEFAULT_PORT),

    DATABASE_KIND: z.enum(databaseKinds).default('sqlite'),
    // DATABASE_PATH applies only to the sqlite backend; DATABASE_URL is required for postgres (enforced below).
    DATABASE_PATH: z.string().default(DEFAULT_DATABASE_PATH),
    DATABASE_URL: z.string().optional(),

    // Length alone cannot catch a copied sample file, and the sample placeholder is deliberately long enough to
    // pass it -- a deployment signing sessions with a string published in this repo is forgeable by anyone, so the
    // known placeholder fails boot outright.
    AUTH_SECRET: z.string().min(32, 'AUTH_SECRET must be at least 32 characters')
        .refine(
            (secret) => secret !== 'CHANGE_ME_this_is_a_placeholder_not_a_real_secret',
            'AUTH_SECRET is still the sample placeholder — generate a real one: openssl rand -base64 32'
        ),

    BASE_URL: z.url().default(DEFAULT_BASE_URL),

    // Blob storage + GC. STORAGE_ROOT is both the fs backend's root and the config the default storage_backend row is
    // seeded with. GC_GRACE_DAYS is the graveyard window before a dereferenced blob is hard-deleted; 0 collects
    // immediately (useful in tests). TRASH_PURGE_DAYS is the window a trashed item survives before the sweeper
    // permanently deletes it; 0 purges on the next sweep. UPLOAD_MAX_BYTES caps a single upload's byte count;
    // AVATAR_MAX_BYTES caps a single avatar image (charged to no quota, so it has its own, much smaller ceiling).
    STORAGE_ROOT: z.string()
        .min(1)
        .default(DEFAULT_STORAGE_ROOT),

    // The built client's directory. Set in production (the Docker image serves the SPA from the API process);
    // absent in development, where Vite owns the client and this server is API-only.
    CLIENT_DIST: z.string().min(1)
        .optional(),
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

    // First-run automation: an operator-chosen token that gates POST /api/setup instead of the boot-printed code,
    // so IaC can complete setup non-interactively. The admin PASSWORD still never rides the environment.
    FILESHED_SETUP_TOKEN: z.string().min(8, 'FILESHED_SETUP_TOKEN must be at least 8 characters')
        .optional(),

    // OAuth provider settings, one optional string per key, generated from the provider vocabulary -- 35 providers
    // would be 70 lines of noise written out. They reach here through the env overlay in loadConfig rather than
    // yaml lines; a provider activates only when every key its contract requires is set (judged at boot, not
    // here -- a partial pair is an admin mid-entry, not a misconfiguration).
    ...providerConfigShape,

    // Outgoing email. These are the config-side defaults for the SMTP_* admin settings (same names); an unset
    // SMTP_HOST or SMTP_FROM leaves mail off. EMAIL_VERIFICATION_REQUIRED is captured at boot -- better-auth
    // freezes it into the auth instance.
    SMTP_HOST: z.string().optional(),
    SMTP_PORT: z.coerce.number()
        .int()
        .positive()
        .default(DEFAULT_SMTP_PORT),
    SMTP_SECURE: booleanish.default(false),
    SMTP_USER: z.string().optional(),
    SMTP_PASSWORD: z.string().optional(),
    SMTP_FROM: z.string().optional(),
    EMAIL_VERIFICATION_REQUIRED: booleanish.default(false),
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
});

export type Config = z.infer<typeof configSchema>;

//----------------------------------------------------------------------------------------------------------------------

const DEFAULT_CONFIG_FILE = './config/config.yaml';

// The default path is found by walking up from the working directory: the server binary and the container both run
// from the directory holding config/, but the Vite dev server runs the API in-process from src/client, two
// directories down. FILESHED_CONFIG bypasses the walk entirely; a fruitless walk falls back to the plain default so
// the not-found error names the expected location.
function findDefaultConfigFile() : string
{
    let dir = process.cwd();

    for(;;)
    {
        const candidate = join(dir, 'config', 'config.yaml');
        if(existsSync(candidate)) { return candidate; }

        const parent = dirname(dir);
        if(parent === dir) { return DEFAULT_CONFIG_FILE; }
        dir = parent;
    }
}

// ${VAR} substitutes the environment variable, ${VAR:-fallback} falls back when it is unset or empty. Substitution
// runs over the raw text BEFORE the yaml parse, so a numeric fallback lands as a real yaml number.
export function substituteEnv(text : string, env : Record<string, string | undefined>) : string
{
    return text.replace(/\$\{([A-Z0-9_]+)(?::-([^}]*))?\}/g, (match, name : string, fallback : string | undefined) =>
    {
        const value = env[name];
        if(value !== undefined && value !== '') { return value; }

        return fallback ?? '';
    });
}

// The parsed document with empty-string values dropped: an empty substitution result means "unset", the same as an
// absent environment variable -- optional schema fields must see undefined, not ''.
function loadConfigDocument(path : string, env : Record<string, string | undefined>) : Record<string, unknown>
{
    let text : string;
    try
    {
        text = readFileSync(path, 'utf8');
    }
    catch
    {
        throw new Error(`Cannot read the configuration file at '${ path }'. The committed config.yaml is the `
            + 'defaults; point FILESHED_CONFIG at yours if it lives elsewhere.');
    }

    const parsed : unknown = parseYaml(substituteEnv(text, env));
    if(typeof parsed !== 'object' || parsed === null || Array.isArray(parsed))
    {
        throw new Error(`The configuration file at '${ path }' must be a yaml mapping.`);
    }

    return Object.fromEntries(Object.entries(parsed).filter(([ , value ]) => value !== '' && value !== null));
}

// Provider credentials skip the yaml: with 35 providers the file would be mostly ${VAR:-} noise. Instead any
// provider setting key set in the environment flows straight into the document (yaml still wins if a deployment
// chose to write the key there), so `GITLAB_CLIENT_ID=... GITLAB_CLIENT_SECRET=...` alone enables a provider.
function overlayProviderEnv(
    document : Record<string, unknown>,
    env : Record<string, string | undefined>
) : Record<string, unknown>
{
    const overlaid = { ...document };

    for(const key of providerSettingKeys)
    {
        const value = env[key];
        if(overlaid[key] === undefined && value !== undefined && value !== '') { overlaid[key] = value; }
    }

    return overlaid;
}

export function loadConfig(env : Record<string, string | undefined> = process.env) : Config
{
    const path = env['FILESHED_CONFIG'] ?? findDefaultConfigFile();
    const result = configSchema.safeParse(overlayProviderEnv(loadConfigDocument(path, env), env));

    if(!result.success)
    {
        throw new Error(`Invalid configuration:\n${ z.prettifyError(result.error) }`);
    }

    return result.data;
}

//----------------------------------------------------------------------------------------------------------------------
