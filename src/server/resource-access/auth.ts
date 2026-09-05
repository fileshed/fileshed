//----------------------------------------------------------------------------------------------------------------------
// Authentication
//
// The better-auth instance for FileShed. It shares the deployment's Kysely connection through the `{ db, type }`
// wiring, so the auth tables (user/session/account/verification) live in the same database as the app schema and can
// carry real FKs (node.owner_id -> user.id, etc.).
//
// The admin() plugin is enabled for its machinery -- it owns the `role` column, enforces bans at session creation, and
// backs impersonation -- but its HTTP surface is blocked at the Hono mount (see app.ts). Server-side auth.api.* calls
// remain the execution arm behind our own admin routes. Externally there is exactly one admin surface: ours.
//
// Column ownership (verified against 1.6.23, see the migration notes): the admin plugin creates `role` (nullable text,
// defaulted to 'user' by the plugin's create hook), and the quotaLimit additionalField creates `quota_limit` as a real
// bigint on both dialects. Migration 001 therefore does NOT add either column -- better-auth's migrator owns them.
//----------------------------------------------------------------------------------------------------------------------

import { type BetterAuthOptions, type User, betterAuth } from 'better-auth';
import { admin } from 'better-auth/plugins';
import { apiKey } from '@better-auth/api-key';
import { createId } from '@paralleldrive/cuid2';
import { sql } from 'kysely';

// Models
import {
    ACCESS_TOKEN_CONFIG_PAT,
    ACCESS_TOKEN_CONFIG_PLAYBACK,
    ACCESS_TOKEN_MAX_EXPIRES_DAYS,
    ACCESS_TOKEN_MIN_EXPIRES_DAYS,
    ACCESS_TOKEN_PREFIX,
    ANY_HOST,
    DISPLAY_NAME_MAX_LENGTH,
    MS_PER_SECOND,
    PLAYBACK_TOKEN_PREFIX,
    PLAYBACK_TOKEN_TTL_MS,
    type ProviderSettingKey,
    type SocialProviderID,
    providerCredentialKeys,
    providerRequiredKeys,
    providerSettingKeys,
    socialProviderIDs,
} from '@fileshed/core';

// Resource Access
import type { DatabaseHandle } from './database/database.ts';

// Utils
import type { Config } from '../utils/config.ts';

//----------------------------------------------------------------------------------------------------------------------

// better-auth's multi-host form of baseURL, as opposed to the plain canonical string.
type DynamicBaseURL = Exclude<NonNullable<BetterAuthOptions['baseURL']>, string>;

// The hosts this instance answers on, and how better-auth builds URLs for them. A request whose host is on the list
// has its base URL built from that host, and everything derived from it follows: the OAuth redirect_uri, the
// verification and reset links. Sign-in started at an alternate origin therefore comes back to that origin instead
// of teleporting to the canonical one. A host that is not on the list resolves to the fallback, which is what makes
// a forged Host (or X-Forwarded-Host) header inert -- it cannot mint a URL, it only ever gets the canonical one.
//
// ALLOWED_HOSTS extends the list, and `*` there accepts every host -- what a development box wants when it is reached
// at localhost, at its LAN IP for cast and phone testing, and at a .local name in the same sitting.
//
// One protocol covers every host, which is why the config refuses a TRUSTED_ORIGINS list that mixes schemes. It is
// also what sets the session cookie's Secure flag -- https here means Secure cookies, exactly as a plain BASE_URL
// string used to decide it.
export function resolveBaseURL(config : Config) : DynamicBaseURL
{
    const canonical = new URL(config.BASE_URL);
    const named = config.TRUSTED_ORIGINS.filter((origin) => origin !== ANY_HOST);
    const hosts = new Set([
        canonical.host,
        ...named.map((origin) => new URL(origin).host),
        ...config.ALLOWED_HOSTS,
    ]);

    return {
        allowedHosts: [ ...hosts ],
        protocol: canonical.protocol === 'https:' ? 'https' : 'http',
        fallback: config.BASE_URL,
    };
}

// What better-auth may believe about where a request came from. It resolves an address from headers alone -- it never
// sees the socket -- so an unlisted proxy means no header is believed at all and the address goes unrecorded, which is
// the honest answer for a value that would otherwise be whatever the client typed. The middleware does see the socket,
// and it is what the rate limiting is keyed on.
export function resolveIpAddressPolicy(config : Config) : { ipAddressHeaders : string[]; trustedProxies : string[] }
{
    const proxies = config.TRUSTED_PROXIES ?? [];

    return {
        ipAddressHeaders: proxies.length > 0 ? [ 'x-forwarded-for' ] : [],
        trustedProxies: proxies,
    };
}

// Origins allowed to hit the auth endpoints. Same-origin requests (client served by the server) never need this; it
// exists for the cross-origin flows. A named list adds nothing: better-auth joins every allowedHosts entry and the
// fallback's origin into the trust list itself, under the same protocol, so listing them again would only duplicate
// it. Only `*` has anything to add, and it matches any host at all.
export function resolveTrustedOrigins(config : Config) : string[]
{
    return config.TRUSTED_ORIGINS.includes(ANY_HOST) ? [ ANY_HOST ] : [];
}

//----------------------------------------------------------------------------------------------------------------------

// The provider setting values as resolved at boot -- settings-over-config-over-env, since admins can enter them
// at runtime (they take effect on the next boot; the routes are frozen into the auth instance).
export type ProviderBootValues = Partial<Record<ProviderSettingKey, string | null>>;

export function providerValuesFromConfig(config : Config) : ProviderBootValues
{
    const values : ProviderBootValues = {};

    for(const key of providerSettingKeys)
    {
        const value = (config as Partial<Record<ProviderSettingKey, string>>)[key];
        values[key] = value ?? null;
    }

    return values;
}

// One provider's better-auth options from the resolved values. The generic shape (id + secret) fits almost every
// provider; the exceptions carry the extra fields their OAuth contract genuinely uses. Called only after the
// required-key gate, so every field a case reads is present.
function providerOptions(provider : SocialProviderID, values : ProviderBootValues) : Record<string, unknown>
{
    const keys = providerCredentialKeys(provider);
    const generic = { clientId: values[keys.clientID], clientSecret: values[keys.clientSecret] };

    switch (provider)
    {
        case 'apple':
            return {
                ...generic,
                ...values.APPLE_APP_BUNDLE_IDENTIFIER
                    ? { appBundleIdentifier: values.APPLE_APP_BUNDLE_IDENTIFIER }
                    : {},
            };
        case 'cognito':
            return {
                ...generic,
                domain: values.COGNITO_DOMAIN,
                region: values.COGNITO_REGION,
                userPoolId: values.COGNITO_USER_POOL_ID,
            };
        case 'gitlab':
            return { ...generic, ...values.GITLAB_ISSUER ? { issuer: values.GITLAB_ISSUER } : {} };
        case 'microsoft':
            return { ...generic, ...values.MICROSOFT_TENANT_ID ? { tenantId: values.MICROSOFT_TENANT_ID } : {} };
        case 'tiktok':
            return { clientKey: values.TIKTOK_CLIENT_KEY, clientSecret: values[keys.clientSecret] };
        default:
            return generic;
    }
}

// The provider ids the same values activate, for /api/instance -- the sign-in page's buttons must mirror exactly
// what the running instance registered.
export function activeProviderIDs(values : ProviderBootValues) : SocialProviderID[]
{
    return socialProviderIDs.filter((provider) =>
    {
        return providerRequiredKeys(provider).every((key) =>
        {
            const value = values[key];
            return typeof value === 'string' && value !== '';
        });
    });
}

// A provider activates only when every key its contract requires is set -- a partially configured provider is
// silently inactive rather than a boot failure, because settings overrides legitimately hold some fields while
// the admin types the rest. No provider complete yields undefined, so better-auth sees no social providers at
// all: email/password stays the only sign-in surface unless a deployment opts one in.
//
// The one cast: better-auth types each provider's options separately, and this builds them dynamically; the
// required-key gate plus the createAuth specs are what keep the shapes honest.
export function socialProvidersFromValues(values : ProviderBootValues) : BetterAuthOptions['socialProviders']
{
    const providers : Record<string, Record<string, unknown>> = {};

    for(const provider of activeProviderIDs(values))
    {
        providers[provider] = providerOptions(provider, values);
    }

    return Object.keys(providers).length > 0
        ? providers as BetterAuthOptions['socialProviders']
        : undefined;
}

//----------------------------------------------------------------------------------------------------------------------

// The two api-key configurations behind FileShed's access tokens. `pat` is the durable, user-managed kind: named,
// prefixed for glance-recognition, expiry user-chosen within the shared day bounds the request codec validates
// against, so the plugin's clamp and the codec cannot drift. `playback` is the media player's short-lived
// download-scoped kind: no name, no stored starting characters (never listed anywhere), expiring on the config
// default alone. Rate limiting is off for both -- FileShed is self-hosted, and the mint route also stamps
// rateLimitEnabled:false per key so no schema default can resurrect it. Expiry values are SECONDS: the shipped
// plugin passes them through getDate(x, 'sec') even though its reference docs say milliseconds -- the dist wins.
const apiKeyConfigurations = [
    {
        configId: ACCESS_TOKEN_CONFIG_PAT,
        defaultPrefix: ACCESS_TOKEN_PREFIX,
        requireName: true,
        rateLimit: { enabled: false },
        keyExpiration: {
            defaultExpiresIn: null,
            minExpiresIn: ACCESS_TOKEN_MIN_EXPIRES_DAYS,
            maxExpiresIn: ACCESS_TOKEN_MAX_EXPIRES_DAYS,
        },
        startingCharactersConfig: { shouldStore: true, charactersLength: 12 },
        deferUpdates: true,
    },
    {
        configId: ACCESS_TOKEN_CONFIG_PLAYBACK,
        defaultPrefix: PLAYBACK_TOKEN_PREFIX,
        rateLimit: { enabled: false },
        keyExpiration: { defaultExpiresIn: PLAYBACK_TOKEN_TTL_MS / MS_PER_SECOND },
        startingCharactersConfig: { shouldStore: false },
        deferUpdates: true,
    },
];

//----------------------------------------------------------------------------------------------------------------------

// A representative of the auth options, present only to give createAuth a nameable return type. better-auth's instance
// type is a deep inference over the enabled plugins and additionalFields (it carries $Infer), with no hand-writable
// annotation that preserves it. The runtime values below are placeholders -- only the shape and its type-bearing parts
// (plugins, additionalFields) matter here; createAuth builds the live options with the real handle and config. This is
// a const object, not a function, so it needs no return-type annotation.
const authOptionsShape = {
    database: {} as { db : DatabaseHandle['db']; type : DatabaseHandle['kind'] },
    secret: '',
    baseURL: { allowedHosts: [], protocol: 'https', fallback: '' } as DynamicBaseURL,
    trustedOrigins: [] as string[],
    // Placeholders past `enabled`, for the type only: createAuth supplies the live mail callbacks and the boot-read
    // verification flag.
    emailAndPassword: {
        enabled: true,
        requireEmailVerification: false as boolean,
        revokeSessionsOnPasswordReset: true,
        sendResetPassword: undefined as NonNullable<BetterAuthOptions['emailAndPassword']>['sendResetPassword'],
        onPasswordReset: undefined as NonNullable<BetterAuthOptions['emailAndPassword']>['onPasswordReset'],
        customSyntheticUser: undefined as NonNullable<BetterAuthOptions['emailAndPassword']>['customSyntheticUser'],
    },
    emailVerification: {
        sendVerificationEmail:
            undefined as NonNullable<BetterAuthOptions['emailVerification']>['sendVerificationEmail'],
    },
    // Placeholder for the type only: createAuth supplies the config-derived value. Carried here so the Auth type
    // reflects that social providers may be configured.
    socialProviders: undefined as BetterAuthOptions['socialProviders'],
    session: {
        // OFF, and it has to stay off. The cache serves a session from a signed snapshot in the browser, so deleting
        // the session row cannot reach it -- for the length of the window, a revoked cookie still authenticates.
        // "Sign out everywhere" cannot survive that: inside the window a stolen cookie mints an access token, and
        // that token outlives the revocation forever. What makes it unfixable at the endpoint is that nothing marks
        // the account, so no later request has anything to re-check. A ban is different only because it sets a
        // standing `banned` flag that every token resolution reads.
        //
        // The price is one indexed read of the session row per request, which is the cost of a revocation meaning
        // what it says.
        cookieCache: { enabled: false },
    },
    plugins: [ admin(), apiKey(apiKeyConfigurations) ],
    // Placeholder for the type only, like socialProviders: createAuth supplies the live hooks, which need the
    // database handle this shape cannot carry.
    databaseHooks: undefined as BetterAuthOptions['databaseHooks'],

    // An OAuth identity never merges itself into an existing password account. Enabled is better-auth's default, and
    // what makes that dangerous here is that nothing in FileShed was holding it back on purpose: implicit linking is
    // gated on the local account being email-verified, and EMAIL_VERIFICATION_REQUIRED ships off, so most accounts
    // are unverified and the merge quietly never happens. Turn verification on -- a reasonable thing for an instance
    // to want -- and every configured provider that asserts a verified address starts merging. Off is the decision;
    // an account holder who wants a provider on their login links it while signed in.
    account: { accountLinking: { enabled: false } },

    // better-auth's own limiter, off, because the middleware covers the same routes and can key them correctly.
    // This one resolves a client from headers alone: with no trusted proxy configured it believes a forged
    // X-Forwarded-For, and with a proxy that appends (nginx's stock config produces `client, proxy`) it resolves
    // nothing and drops the entire instance into one shared bucket. Two limiters answering 429 on one route, one of
    // them wrong in both deployment shapes, is worse than one that is right.
    rateLimit: { enabled: false },

    advanced: {
        // cuid2 everywhere, matching the app's own ids.
        database: { generateId: () => createId() },

        // Placeholder for the type only: createAuth supplies the config-derived policy.
        ipAddress: { ipAddressHeaders: [] as string[], trustedProxies: [] as string[] },
    },
    user: {
        additionalFields: {
            // The per-user byte cap. bigint:true makes better-auth emit a real bigint column on Postgres (and 64-bit
            // INTEGER on SQLite) so quotas above 2^31 bytes are representable. input:false keeps it out of the sign-up
            // payload -- quota is admin-set, never self-served.
            quotaLimit: { type: 'number', required: false, input: false, bigint: true, fieldName: 'quota_limit' },

            // The preferences blob: a single text column holding JSON. adding a preference never needs a migration,
            // and unknown keys survive writes (the app merges key-wise). type:'string' emits a plain text column on
            // both dialects; input:false keeps it out of the sign-up payload and off better-auth's own update surface
            // -- it is written only through our PATCH /api/me/preferences, never round-tripped through the auth API.
            preferences: { type: 'string', required: false, input: false, fieldName: 'preferences' },

            // The avatar: the sha256 of its bytes in the blob store, and the mime to serve them with. Same
            // input:false discipline as preferences -- both are written only through our own /api/me/avatar routes,
            // never the auth API. The mime is stored because an avatar blob has no node row to carry one.
            avatarSha256: { type: 'string', required: false, input: false, fieldName: 'avatar_sha256' },
            avatarMime: { type: 'string', required: false, input: false, fieldName: 'avatar_mime' },
        },
    },
} satisfies BetterAuthOptions;

export type Auth = ReturnType<typeof betterAuth<typeof authOptionsShape>>;

//----------------------------------------------------------------------------------------------------------------------

// Every access token an account holds, dropped in one statement. The apikey table is better-auth territory (its
// migrator owns it, camelCase columns, referenceId has no FK to user), so this is raw SQL rather than a typed
// Kysely table: keys must not survive their owner losing standing.
export async function deleteAccessTokensFor(handle : DatabaseHandle, userID : string) : Promise<void>
{
    await sql`delete from apikey where "referenceId" = ${ userID }`.execute(handle.db);
}

// Pending one-time actions against this account, the password reset already sitting in a mailbox above all. Matched
// on the user id rather than on token names because that is where better-auth puts it for these: the identifier
// column carries the token, the value column carries whose account it acts on.
//
// That convention is the whole reach of this, and it is narrower than it looks. A flow that keys its row by email
// address or stores something other than a bare user id in `value` is NOT covered -- magic-link and the email-OTP
// flows both do exactly that -- so enabling one of those plugins means coming back here, not trusting this to
// follow. Verification and change-email tokens are signed JWTs holding no row at all and cannot be revoked by
// deleting anything. Configuring secondaryStorage moves verification values out of the table and this misses all of
// them.
export async function deletePendingAccountActionsFor(handle : DatabaseHandle, userID : string) : Promise<void>
{
    await sql`delete from verification where value = ${ userID }`.execute(handle.db);
}

// Access tokens die with their owner's standing, and a display name is bounded before it is stored. Database hooks
// fire on the row operation itself, so every path to a ban (admin route, server-side auth.api call, future surfaces)
// and every path to a new account (email sign-up, a provider's first login) is covered without enumerating endpoints
// -- and key verification never consults the user row, so revocation here is what makes a ban stick for outstanding
// keys. Ban deletion is permanent: unbanning does not resurrect keys. Typed against BetterAuthOptions so the live
// options object matches the shape's placeholder exactly.
function accessTokenCleanupHooks(handle : DatabaseHandle) : BetterAuthOptions['databaseHooks']
{
    return {
        user: {
            // `name` is better-auth's own field, not one of ours, so no codec of this project ever sees it and the
            // length our own surfaces enforce never reaches sign-up. A megabyte of display name would otherwise ride
            // into every listing that names its owner.
            create: {
                before: async (user : User) =>
                {
                    const name = user.name.trim();

                    return { data: { ...user, name: name.slice(0, DISPLAY_NAME_MAX_LENGTH) } };
                },
            },
            update: {
                after: async (user : User) =>
                {
                    if((user as User & { banned ?: boolean | null }).banned === true)
                    {
                        await deleteAccessTokensFor(handle, user.id);
                    }
                },
            },
            delete: {
                after: async (user : User) =>
                {
                    await deleteAccessTokensFor(handle, user.id);
                },
            },
        },
    };
}

//----------------------------------------------------------------------------------------------------------------------

// The mail hooks better-auth calls mid-flow. Deliberately a tiny interface rather than the MailManager type:
// resource access must not import managers, so the manager satisfies this structurally at composition. Both
// senders are fire-and-forget by contract -- a reset request must answer identically whether the send worked.
export interface AuthMailHooks
{
    sendPasswordReset(to : string, url : string) : void;
    sendVerification(to : string, url : string) : void;
}

export interface AuthExtras
{
    mail ?: AuthMailHooks;

    // Read from settings-over-config at boot; better-auth freezes it into the instance, which is why the setting
    // is restart-tier.
    requireEmailVerification ?: boolean;

    // Provider credentials resolved settings-over-config at boot -- same freezing, same restart tier. Absent falls
    // back to config alone (the auth-only test compositions).
    providerValues ?: ProviderBootValues;
}

// The live email options, annotated with the shape's own types so the betterAuth generic stays pinned to the
// shape (the same trick socialProviders and databaseHooks use).
function emailAndPasswordOptions(
    handle : DatabaseHandle,
    mail : AuthMailHooks | undefined,
    requireEmailVerification : boolean
) : typeof authOptionsShape['emailAndPassword']
{
    return {
        enabled: true,
        requireEmailVerification,
        // A reset means the credential may have been compromised; every other session dies with it.
        revokeSessionsOnPasswordReset: true,
        // And so does every access token. better-auth ends the sessions itself but knows nothing about our tokens,
        // and a reset that leaves a stolen PAT answering is a reset that changed nothing for whoever holds it.
        onPasswordReset: async ({ user }) => { await deleteAccessTokensFor(handle, user.id); },
        sendResetPassword: mail === undefined
            ? undefined
            : async ({ user, url }) => { mail.sendPasswordReset(user.email, url); },
        // With enumeration protection active (requireEmailVerification), the synthetic sign-up response must
        // carry every field a real one would: the admin plugin's columns in schema order, then our
        // additionalFields, then the id (the documented assembly order).
        customSyntheticUser: ({ coreFields, additionalFields, id }) => ({
            ...coreFields,
            role: 'user',
            banned: false,
            banReason: null,
            banExpires: null,
            ...additionalFields,
            id,
        }),
    };
}

function emailVerificationOptions(mail : AuthMailHooks | undefined) : typeof authOptionsShape['emailVerification']
{
    return {
        sendVerificationEmail: mail === undefined
            ? undefined
            : async ({ user, url }) => { mail.sendVerification(user.email, url); },
    };
}

// The secret is a parameter rather than a config read: config.AUTH_SECRET is optional, and the value that actually
// signs sessions is resolved at boot (environment over stored over generated, see managers/authSecret.ts).
export function createAuth(handle : DatabaseHandle, config : Config, secret : string, extras : AuthExtras = {}) : Auth
{
    return betterAuth({
        ...authOptionsShape,
        database: { db: handle.db, type: handle.kind },
        secret,
        baseURL: resolveBaseURL(config),
        trustedOrigins: resolveTrustedOrigins(config),
        socialProviders: socialProvidersFromValues(extras.providerValues ?? providerValuesFromConfig(config)),
        emailAndPassword: emailAndPasswordOptions(handle, extras.mail, extras.requireEmailVerification ?? false),
        emailVerification: emailVerificationOptions(extras.mail),
        // Fresh plugin instances per auth instance; the shape above supplies only their type.
        plugins: [ admin(), apiKey(apiKeyConfigurations) ],
        databaseHooks: accessTokenCleanupHooks(handle),
        advanced: { ...authOptionsShape.advanced, ipAddress: resolveIpAddressPolicy(config) },
    });
}

// The signed-in user as better-auth infers it: the base identity plus the admin plugin's `role` and our `quotaLimit`
// additionalField. Shared by the session helper and the admin manager.
export type SessionUser = Auth['$Infer']['Session']['user'];

//----------------------------------------------------------------------------------------------------------------------
