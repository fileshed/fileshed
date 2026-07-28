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
    ACCESS_TOKEN_PREFIX,
    MS_PER_SECOND,
    PLAYBACK_TOKEN_PREFIX,
    PLAYBACK_TOKEN_TTL_MS,
} from '@fileshed/core';

// Resource Access
import type { DatabaseHandle } from './database/database.ts';

// Utils
import type { Config } from '../utils/config.ts';

//----------------------------------------------------------------------------------------------------------------------

// Origins allowed to hit the auth endpoints. Same-origin requests (client served by the server) never need this; it
// exists for the cross-origin flows. Production trusts only the configured BASE_URL. Development turns origin
// matching off entirely (better-auth's bare `*` pattern matches any host) -- a dev box gets reached however is
// handy: localhost, the machine's LAN IP for cast/phone testing, a .local hostname. The rest of the CSRF machinery
// stays on; only the origin allowlist opens up, and only outside production.
function resolveTrustedOrigins(config : Config) : string[]
{
    if(process.env['NODE_ENV'] !== 'production') { return [ config.BASE_URL, '*' ]; }

    return [ config.BASE_URL ];
}

//----------------------------------------------------------------------------------------------------------------------

// The social sign-in providers better-auth should offer, derived entirely from config: a provider is included only
// when BOTH halves of its env pair are present (the config schema enforces both-or-neither, so a single half is a boot
// failure long before here). No pair configured yields undefined, so better-auth sees no social providers at all --
// email/password stays the only sign-in surface unless a deployment opts one in.
export function socialProvidersFromConfig(config : Config) : BetterAuthOptions['socialProviders']
{
    const providers : NonNullable<BetterAuthOptions['socialProviders']> = {};

    if(config.GITHUB_CLIENT_ID && config.GITHUB_CLIENT_SECRET)
    {
        providers.github = { clientId: config.GITHUB_CLIENT_ID, clientSecret: config.GITHUB_CLIENT_SECRET };
    }

    if(config.GOOGLE_CLIENT_ID && config.GOOGLE_CLIENT_SECRET)
    {
        providers.google = { clientId: config.GOOGLE_CLIENT_ID, clientSecret: config.GOOGLE_CLIENT_SECRET };
    }

    return Object.keys(providers).length > 0 ? providers : undefined;
}

//----------------------------------------------------------------------------------------------------------------------

// The two api-key configurations behind FileShed's access tokens. `pat` is the durable, user-managed kind: named,
// prefixed for glance-recognition, expiry user-chosen (the 1-365 day bounds live in the request codec and happen to
// match the plugin's own clamp). `playback` is the media player's short-lived download-scoped kind: no name, no
// stored starting characters (never listed anywhere), expiring on the config default alone. Rate limiting is off for
// both -- FileShed is self-hosted, and the mint route also stamps rateLimitEnabled:false per key so no schema
// default can resurrect it. Expiry values are SECONDS: the shipped plugin passes them through getDate(x, 'sec')
// even though its reference docs say milliseconds -- the dist wins.
const apiKeyConfigurations = [
    {
        configId: ACCESS_TOKEN_CONFIG_PAT,
        defaultPrefix: ACCESS_TOKEN_PREFIX,
        requireName: true,
        rateLimit: { enabled: false },
        keyExpiration: { defaultExpiresIn: null, minExpiresIn: 1, maxExpiresIn: 365 },
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
    baseURL: '',
    trustedOrigins: [] as string[],
    emailAndPassword: { enabled: true },
    // Placeholder for the type only: createAuth supplies the config-derived value. Carried here so the Auth type
    // reflects that social providers may be configured.
    socialProviders: undefined as BetterAuthOptions['socialProviders'],
    session: {
        // Serve the session from a short-lived signed cookie so getSession on hot paths skips a DB round-trip.
        // The cookie lives in the BROWSER, so revoking DB sessions (a ban does) cannot reach it before it expires
        // -- 60 seconds caps that window at a cost of one session read per user per minute. Access tokens have no
        // such lag: the ban hooks delete them outright.
        cookieCache: { enabled: true, maxAge: 60 },
    },
    plugins: [ admin(), apiKey(apiKeyConfigurations) ],
    // Placeholder for the type only, like socialProviders: createAuth supplies the live hooks, which need the
    // database handle this shape cannot carry.
    databaseHooks: undefined as BetterAuthOptions['databaseHooks'],
    advanced: {
        // cuid2 everywhere, matching the app's own ids.
        database: { generateId: () => createId() },
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

// Access-token cleanup shared by the ban and deletion hooks. The apikey table is better-auth territory (its
// migrator owns it, camelCase columns, referenceId has no FK to user), so this is raw SQL rather than a typed
// Kysely table: keys must not survive their owner losing standing.
async function deleteAccessTokensFor(handle : DatabaseHandle, userID : string) : Promise<void>
{
    await sql`delete from apikey where "referenceId" = ${ userID }`.execute(handle.db);
}

// Access tokens die with their owner's standing. Database hooks fire on the row operation itself, so every path to
// a ban (admin route, server-side auth.api call, future surfaces) is covered without enumerating endpoints -- and
// key verification never consults the user row, so revocation here is what makes a ban stick for outstanding keys.
// Ban deletion is permanent: unbanning does not resurrect keys. Typed against BetterAuthOptions so the live options
// object matches the shape's placeholder exactly.
function accessTokenCleanupHooks(handle : DatabaseHandle) : BetterAuthOptions['databaseHooks']
{
    return {
        user: {
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

export function createAuth(handle : DatabaseHandle, config : Config) : Auth
{
    return betterAuth({
        ...authOptionsShape,
        database: { db: handle.db, type: handle.kind },
        secret: config.AUTH_SECRET,
        baseURL: config.BASE_URL,
        trustedOrigins: resolveTrustedOrigins(config),
        socialProviders: socialProvidersFromConfig(config),
        // Fresh plugin instances per auth instance; the shape above supplies only their type.
        plugins: [ admin(), apiKey(apiKeyConfigurations) ],
        databaseHooks: accessTokenCleanupHooks(handle),
    });
}

// The signed-in user as better-auth infers it: the base identity plus the admin plugin's `role` and our `quotaLimit`
// additionalField. Shared by the session helper and the admin manager.
export type SessionUser = Auth['$Infer']['Session']['user'];

//----------------------------------------------------------------------------------------------------------------------
