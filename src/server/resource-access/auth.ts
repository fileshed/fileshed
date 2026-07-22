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

import { type BetterAuthOptions, betterAuth } from 'better-auth';
import { admin } from 'better-auth/plugins';
import { createId } from '@paralleldrive/cuid2';

// Resource Access
import type { DatabaseHandle } from './database/database.ts';

// Utils
import type { Config } from '../utils/config.ts';

//----------------------------------------------------------------------------------------------------------------------

// Origins allowed to hit the auth endpoints. Same-origin requests (client served by the server) never need this; it
// exists for the cross-origin dev flow where Vite serves the client on 5173 and the API answers on 3000. Production
// trusts only the configured BASE_URL.
function resolveTrustedOrigins(config : Config) : string[]
{
    const origins = new Set<string>([ config.BASE_URL ]);

    if(process.env['NODE_ENV'] !== 'production')
    {
        origins.add('http://localhost:5173');
        origins.add('http://localhost:3000');
    }

    return [ ...origins ];
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
        // Conscious tradeoff: role changes and bans lag until the cookie refreshes (~5 min) -- a just-demoted admin
        // keeps admin access for that window. Revisit before ban/impersonation surfaces ship.
        cookieCache: { enabled: true },
    },
    plugins: [ admin() ],
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
        },
    },
} satisfies BetterAuthOptions;

export type Auth = ReturnType<typeof betterAuth<typeof authOptionsShape>>;

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
        plugins: [ admin() ],
    });
}

// The signed-in user as better-auth infers it: the base identity plus the admin plugin's `role` and our `quotaLimit`
// additionalField. Shared by the session helper and the admin manager.
export type SessionUser = Auth['$Infer']['Session']['user'];

//----------------------------------------------------------------------------------------------------------------------
