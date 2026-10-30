//----------------------------------------------------------------------------------------------------------------------
// Auth Spec Support
//
// Boots the real stack against a fresh in-memory SQLite database: the actual factory, the actual auth instance, and the
// actual boot orchestration (better-auth migrations + app migrations + admin bootstrap). No HTTP server, no mocks --
// specs drive the app with app.request and read state through the real Kysely handle.
//----------------------------------------------------------------------------------------------------------------------

import type { Hono } from 'hono';

import { DEFAULT_UPLOAD_CHUNK_BYTES } from '@fileshed/core';

// Resource Access
import type { DatabaseHandle } from '@server/resource-access/database/database.ts';
import { type Auth, type AuthExtras, authOptions, createAuth } from '@server/resource-access/auth/instance.ts';
import { MailRA } from '@server/resource-access/mail/index.ts';

// Managers
import { MailManager } from '@server/managers/mail.ts';
import { SettingsManager } from '@server/managers/settings.ts';

// App
import { migrateDatabase } from '@server/boot.ts';
import { createApp } from '@server/clients/http/app.ts';
import { type AppServices, composeServices } from '@server/services.ts';

// Utils
import type { Config } from '@server/utils/config.ts';
import { SecretBox } from '@server/utils/secretBox.ts';
import { resolveBuildInfo } from '@server/utils/version.ts';

// Test support
import { openTestDatabase } from '../support/database.ts';

//----------------------------------------------------------------------------------------------------------------------

export const ORIGIN = 'http://localhost:3000';

// The explicit secret every in-process spec boots with, standing in for a deployment that sets AUTH_SECRET. Specs
// about resolving an UNSET one drive the resolver directly.
export const TEST_AUTH_SECRET = 'test-auth-secret-test-auth-secret-test';

// Baked in the way an image build bakes them, so composing an app never spawns git.
const testBuild = resolveBuildInfo({ COMMIT_SHA: 'f11e5ed5f11e5ed5f11e5ed5f11e5ed5f11e5ed5', COMMIT_REF: 'spec' });

export function testConfig(overrides : Partial<Config> = {}) : Config
{
    // Stated whole, then overridden: spreading a Partial into the literal makes the keys it names optional,
    // and the result stops being a Config.
    const defaults : Config = {
        HOST: '0.0.0.0',
        PORT: 3000,
        DATABASE_KIND: 'sqlite',
        DATABASE_PATH: ':memory:',
        DATABASE_URL: undefined,
        FILESHED_DISCARD_SEALED_SECRETS: false,
        AUTH_SECRET: TEST_AUTH_SECRET,
        BASE_URL: ORIGIN,
        TRUSTED_ORIGINS: [],
        ALLOWED_HOSTS: [],
        TRUSTED_PROXIES: null,
        RATE_LIMIT_ENABLED: true,
        RATE_LIMIT_WINDOW_SECONDS: 60,
        RATE_LIMIT_MAX: 600,
        RATE_LIMIT_CREDENTIALS_MAX: 10,
        RATE_LIMIT_ANONYMOUS_MAX: 120,
        ALLOW_INSECURE_COOKIES: false,
        FILESHED_SETUP_TOKEN: undefined,
        STORAGE_ROOT: './data/blobs',
        GC_GRACE_DAYS: 7,
        GC_INTERVAL_MINUTES: 60,
        TRASH_PURGE_DAYS: 30,
        ACCOUNT_DELETION_DAYS: 30,
        UPLOAD_MAX_BYTES: 5 * 1024 * 1024 * 1024,
        AVATAR_MAX_BYTES: 2 * 1024 * 1024,
        UPLOAD_CHUNK_BYTES: DEFAULT_UPLOAD_CHUNK_BYTES,
        SMTP_HOST: undefined,
        SMTP_PORT: 587,
        SMTP_SECURE: false,
        SMTP_USER: undefined,
        SMTP_PASSWORD: undefined,
        SMTP_FROM: undefined,
        EMAIL_VERIFICATION_REQUIRED: false,
    };

    return { ...defaults, ...overrides };
}

//----------------------------------------------------------------------------------------------------------------------

export interface BootedApp
{
    config : Config;
    handle : DatabaseHandle;
    auth : Auth;
    app : Hono;
}

// The composition bootApp serves, over the one handle: the settings manager the routes patch is the one the gate
// middleware and every settings-backed supplier read. Composing touches neither the database nor the storage root,
// which is what lets the route-table and OpenAPI specs use it unmigrated.
export function composeTestServices(auth : Auth, handle : DatabaseHandle, config : Config) : AppServices
{
    const started = new Date();
    const settings = new SettingsManager({
        handle,
        config,
        box: new SecretBox(TEST_AUTH_SECRET),
        started,
    });

    return composeServices({
        config,
        handle,
        auth,
        settings,
        mail: new MailManager({ settings, mail: new MailRA() }),
        providers: [],
        build: testBuild,
        started,
    });
}

export interface ComposeOptions
{
    // The interactive reference, which bootApp mounts only on request. A spec asserting on it has to ask, the same way
    // a developer does at the command line.
    apiReference ?: boolean;
}

export function composeTestApp(
    auth : Auth,
    handle : DatabaseHandle,
    config : Config,
    options : ComposeOptions = {}
) : Hono
{
    const services = composeTestServices(auth, handle, config);

    return createApp({ auth, services }, { apiReference: options.apiReference });
}

export async function bootTestApp(overrides : Partial<Config> = {}, extras : AuthExtras = {}) : Promise<BootedApp>
{
    const { config, handle } = await openTestDatabase(testConfig(overrides));
    await migrateDatabase(handle, authOptions(handle, config, TEST_AUTH_SECRET));

    const auth = createAuth(handle, config, TEST_AUTH_SECRET, extras);

    return { config, handle, auth, app: composeTestApp(auth, handle, config) };
}

//----------------------------------------------------------------------------------------------------------------------
// HTTP helpers
//----------------------------------------------------------------------------------------------------------------------

export async function signUp(app : Hono, email : string, password : string, name = 'Test User') : Promise<Response>
{
    return app.request(`${ ORIGIN }/api/auth/sign-up/email`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'origin': ORIGIN },
        body: JSON.stringify({ email, name, password }),
    });
}

export async function signIn(app : Hono, email : string, password : string) : Promise<Response>
{
    return app.request(`${ ORIGIN }/api/auth/sign-in/email`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'origin': ORIGIN },
        body: JSON.stringify({ email, password }),
    });
}

// The session cookie is the first token of the Set-Cookie header (name=value), the form a browser echoes back.
export function cookieFrom(res : Response) : string
{
    return res.headers.get('set-cookie')?.split(';')[0] ?? '';
}

// Every cookie the response sets, joined as a browser would send them back. The session cookie cache is off, so this
// is the session token and nothing beside it -- which is the point of still having it: a spec that sends the whole jar
// asserts the answer came from the session row no matter what the browser happens to be carrying. Turn the cache back
// on and better-auth adds a signed snapshot of the user row here, and these are the specs that notice.
export function cookieJarFrom(res : Response) : string
{
    return res.headers.getSetCookie()
        .map((cookie) => cookie.split(';')[0])
        .join('; ');
}

// Sign up, then flip the account to admin at the database. A fresh sign-in afterwards mints a session that reflects the
// promoted role (the sign-up cookie predates it).
export async function makeAdmin(
    booted : Pick<BootedApp, 'app' | 'handle'>,
    email : string,
    password : string
) : Promise<string>
{
    await signUp(booted.app, email, password);
    await booted.handle.db.updateTable('user').set({ role: 'admin' })
        .where('email', '=', email)
        .execute();

    return cookieFrom(await signIn(booted.app, email, password));
}

//----------------------------------------------------------------------------------------------------------------------
