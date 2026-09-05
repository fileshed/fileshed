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
    ANY_HOST,
    DEFAULT_AVATAR_MAX_BYTES,
    DEFAULT_BASE_URL,
    DEFAULT_DATABASE_PATH,
    DEFAULT_GC_GRACE_DAYS,
    DEFAULT_GC_INTERVAL_MINUTES,
    DEFAULT_HOST,
    DEFAULT_PORT,
    DEFAULT_RATE_LIMIT_ANONYMOUS_MAX,
    DEFAULT_RATE_LIMIT_CREDENTIALS_MAX,
    DEFAULT_RATE_LIMIT_MAX,
    DEFAULT_RATE_LIMIT_WINDOW_SECONDS,
    DEFAULT_SMTP_PORT,
    DEFAULT_STORAGE_ROOT,
    DEFAULT_TRASH_PURGE_DAYS,
    DEFAULT_UPLOAD_CHUNK_BYTES,
    DEFAULT_UPLOAD_MAX_BYTES,
    MIN_UPLOAD_CHUNK_BYTES,
    type ProviderSettingKey,
    databaseKinds,
    providerSettingKeys,
} from '@fileshed/core';

// Utils
import { parseProxyEntry } from './ip.ts';
import { logSecurityPolicy } from './securityPolicy.ts';

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

// One ALLOWED_HOSTS entry reduced to the host a request's Host header carries, or null when the entry is not one. A
// full URL is refused rather than trimmed down to its host: an entry with a scheme on it is somebody writing an origin
// where a host goes, and silently accepting both spellings is how a list stops saying what it means.
function normalizeHost(entry : string) : string | null
{
    if(entry.includes('/') || entry.includes('@')) { return null; }

    try
    {
        const url = new URL(`http://${ entry }`);

        return url.host === entry.toLowerCase() && url.hostname !== '' ? url.host : null;
    }
    catch
    {
        return null;
    }
}

// One TRUSTED_ORIGINS entry reduced to what a browser's Origin header carries, or null when the entry cannot be
// one. The host half becomes better-auth's allowedHosts and the whole origin its trust list (see
// resource-access/auth.ts), both matched by exact string -- an entry keeping a path or a trailing slash would match
// nothing at all. Only http and https carry an origin a browser sends: a bare hostname does not parse as a URL, and
// a scheme like mailto: has no origin, so both come back null.
function normalizeOrigin(entry : string) : string | null
{
    try
    {
        const url = new URL(entry);
        if(url.protocol !== 'http:' && url.protocol !== 'https:') { return null; }

        return url.origin;
    }
    catch
    {
        return null;
    }
}

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

    // Optional: an unset AUTH_SECRET is read from the secret file, which FileShed generates on a first run
    // (managers/authSecret.ts). Set, it beats that file and must still clear both bars -- length alone cannot
    // catch a copied sample file, and the sample placeholder is deliberately long enough to pass it, so a
    // deployment signing sessions with a string published in this repo fails boot outright.
    AUTH_SECRET: z.string().min(32, 'AUTH_SECRET must be at least 32 characters')
        .refine(
            (secret) => secret !== 'CHANGE_ME_this_is_a_placeholder_not_a_real_secret',
            'AUTH_SECRET is still the sample placeholder — generate a real one: openssl rand -base64 32'
        )
        .optional(),

    // Where that secret file lives. Unset, FileShed manages one next to the database and generates it when it is
    // missing; pointed anywhere else, the file belongs to the operator -- read, never written, and a missing one
    // fails the boot rather than being guessed at.
    AUTH_SECRET_FILE: z.string().min(1)
        .optional(),

    // The key an earlier AUTH_SECRET used, carried for one boot so settings sealed under it are re-sealed under
    // the new one. Deliberately unvalidated: it only ever opens stored values, and never signs a session.
    AUTH_SECRET_PREVIOUS: z.string().min(1)
        .optional(),

    // The one-shot answer to the refusal to boot with settings no available key can open: clear them instead.
    FILESHED_DISCARD_SEALED_SECRETS: booleanish.default(false),

    // The canonical URL. http(s) only: it is the instance's own scheme and host, and everything from the setup
    // announcement to better-auth's URL construction is built from those two.
    BASE_URL: z.url({
        protocol: /^https?$/,
        error: 'BASE_URL must be an http(s) URL, e.g. https://files.example.com',
    }).default(DEFAULT_BASE_URL),

    // Further origins the instance answers on, comma-separated, for a deployment reachable at more than one URL.
    // Each entry is normalized to its origin; one that has none fails the boot and is named in the message, rather
    // than loading into a list where it can never match. Empty leaves BASE_URL the only URL answered on.
    //
    // `*` on its own answers any origin at all, which is what a development box wants and what nothing serving real
    // users should have. It is refused alongside named origins: a list that already matches everything cannot also
    // be a list of what is allowed.
    TRUSTED_ORIGINS: z.string()
        .transform((value, ctx) =>
        {
            const entries = value.split(',')
                .map((entry) => entry.trim())
                .filter((entry) => entry !== '');

            if(entries.includes(ANY_HOST))
            {
                if(entries.length > 1)
                {
                    ctx.addIssue({
                        code: 'custom',
                        message: `TRUSTED_ORIGINS is either ${ ANY_HOST } or a list of origins, not both.`,
                    });
                }

                return [ ANY_HOST ];
            }

            const origins : string[] = [];
            for(const entry of entries)
            {
                const origin = normalizeOrigin(entry);
                if(origin === null)
                {
                    ctx.addIssue({
                        code: 'custom',
                        message: `TRUSTED_ORIGINS entry '${ entry }' is not an http(s) URL. Write each origin in `
                            + 'full, like https://files.example.com',
                    });
                }
                else
                {
                    origins.push(origin);
                }
            }

            return origins;
        })
        .default([]),

    // Hosts this instance will build its own URLs from, beyond BASE_URL's and TRUSTED_ORIGINS'. better-auth reads the
    // request's Host header and mints verification links, reset links and OAuth callbacks against it when the host is
    // on this list; anything else gets BASE_URL. That is what makes a forged Host (or X-Forwarded-Host) inert, so `*`
    // -- which accepts every host, and which a development box wants -- hands whoever sends one the ability to put
    // their own address in a password-reset email. Entries are `host` or `host:port`, never a full URL.
    ALLOWED_HOSTS: z.string()
        .transform((value, ctx) : string[] =>
        {
            const entries = value.split(',')
                .map((entry) => entry.trim())
                .filter((entry) => entry !== '');

            if(entries.includes(ANY_HOST))
            {
                if(entries.length > 1)
                {
                    ctx.addIssue({
                        code: 'custom',
                        message: `ALLOWED_HOSTS is either ${ ANY_HOST } or a list of hosts, not both.`,
                    });
                }

                return [ ANY_HOST ];
            }

            const hosts : string[] = [];
            for(const entry of entries)
            {
                const host = normalizeHost(entry);
                if(host === null)
                {
                    ctx.addIssue({
                        code: 'custom',
                        message: `ALLOWED_HOSTS entry '${ entry }' is not a host. Write each as a hostname with an `
                            + 'optional port, like files.example.com or 192.168.1.50:3950.',
                    });
                }
                else
                {
                    hosts.push(host);
                }
            }

            return hosts;
        })
        .default([]),

    // The reverse proxies whose X-Forwarded-For this instance believes, as IP addresses or CIDR ranges. Unset is
    // undecided and says so at boot; the literal `none` is the decision that nothing fronts this instance. Either
    // way an unlisted peer's forwarded header is ignored and the socket it connected on is the client -- an address
    // the client cannot choose, which is the whole point. Name the proxies, not a private range that also covers
    // your users; a range covering a client lets that client forge its own address again.
    TRUSTED_PROXIES: z.string()
        .optional()
        .transform((value, ctx) : string[] | null =>
        {
            if(value === undefined) { return null; }
            if(value.trim().toLowerCase() === 'none') { return []; }

            const entries = value.split(',')
                .map((entry) => entry.trim())
                .filter((entry) => entry !== '');

            const proxies : string[] = [];
            for(const entry of entries)
            {
                if(parseProxyEntry(entry) === null)
                {
                    ctx.addIssue({
                        code: 'custom',
                        message: `TRUSTED_PROXIES entry '${ entry }' is not an IP address or CIDR range. Write each `
                            + 'as an address or a range, like 10.0.0.7 or 10.0.0.0/24, or set it to `none` if no '
                            + 'proxy fronts this instance.',
                    });
                }
                else
                {
                    proxies.push(entry);
                }
            }

            return proxies;
        }),

    // Request budgets, per client per window. RATE_LIMIT_MAX covers /api at large; the credential endpoints
    // (sign-in, sign-up, reset, verification, first-run setup) and the anonymous /d links carry their own, because
    // what they cost an instance is nothing like a page load.
    RATE_LIMIT_ENABLED: booleanish.default(true),
    RATE_LIMIT_WINDOW_SECONDS: z.coerce.number()
        .int()
        .positive()
        .default(DEFAULT_RATE_LIMIT_WINDOW_SECONDS),
    RATE_LIMIT_MAX: z.coerce.number()
        .int()
        .positive()
        .default(DEFAULT_RATE_LIMIT_MAX),
    RATE_LIMIT_CREDENTIALS_MAX: z.coerce.number()
        .int()
        .positive()
        .default(DEFAULT_RATE_LIMIT_CREDENTIALS_MAX),
    RATE_LIMIT_ANONYMOUS_MAX: z.coerce.number()
        .int()
        .positive()
        .default(DEFAULT_RATE_LIMIT_ANONYMOUS_MAX),

    // Acknowledges that this instance is genuinely served over plain http, which is the one case where a session
    // cookie without Secure is not a mistake. It changes no behaviour -- the cookie flag follows BASE_URL's scheme
    // either way -- it only settles whether the boot warning is telling an operator something they do not know.
    ALLOW_INSECURE_COOKIES: booleanish.default(false),

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

    // The size an upload is cut into, handed to the client with its ticket. Raising it is the reason this is tunable:
    // an operator who knows their own proxy accepts more can spend fewer round trips, and no ceiling is imposed here
    // because only that operator knows what their stack will take. The floor is real, though -- see the constant.
    UPLOAD_CHUNK_BYTES: z.coerce.number()
        .int()
        .min(MIN_UPLOAD_CHUNK_BYTES, {
            error: (issue) => `UPLOAD_CHUNK_BYTES is ${ issue.input }, below the ${ MIN_UPLOAD_CHUNK_BYTES }-byte `
                + '(1 MiB) floor. A chunk that small clears no proxy anything larger does not, and only multiplies '
                + 'the round trips a large upload costs.',
        })
        .default(DEFAULT_UPLOAD_CHUNK_BYTES),

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

    // better-auth builds every alternate's URLs under a single protocol, taken from BASE_URL (see
    // resource-access/auth.ts), and that same value decides whether session cookies are Secure. A list mixing
    // schemes therefore cannot be served: half of it would be built, and cookied, wrong.
    const scheme = new URL(config.BASE_URL).protocol;
    const mismatched = config.TRUSTED_ORIGINS
        .filter((origin) => origin !== ANY_HOST)
        .filter((origin) => new URL(origin).protocol !== scheme);

    if(mismatched.length > 0)
    {
        ctx.addIssue({
            code: 'custom',
            path: [ 'TRUSTED_ORIGINS' ],
            message: `TRUSTED_ORIGINS must use BASE_URL's scheme (${ scheme }//): ${ mismatched.join(', ') }`,
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

// ${VAR} substitutes the environment variable, ${VAR:-fallback} falls back when it is unset or empty.
//
// Substitution runs over the raw text BEFORE the yaml parse, which means a value carries whatever meaning yaml gives
// its characters: `*` opens an alias, a spaced `#` starts a comment, a bare `yes` is a boolean. Every value in the
// template is therefore written inside a single-quoted scalar, where the only character with meaning left is the
// quote itself -- doubled here, so a password with one in it cannot close the scalar and become yaml. Numbers and
// booleans arrive as strings and the schema coerces them, which it has to do for the environment anyway.
export function substituteEnv(text : string, env : Record<string, string | undefined>) : string
{
    return text.replace(/\$\{([A-Z0-9_]+)(?::-([^}]*))?\}/g, (match, name : string, fallback : string | undefined) =>
    {
        const value = env[name];
        const resolved = value !== undefined && value !== '' ? value : fallback ?? '';

        return resolved.replaceAll('\'', '\'\'');
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

    // Every deployment passes through here exactly once, which is what makes it the place to say out loud what the
    // loaded values leave open.
    logSecurityPolicy(result.data, env);

    return result.data;
}

//----------------------------------------------------------------------------------------------------------------------
