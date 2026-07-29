//----------------------------------------------------------------------------------------------------------------------
// Auth Spec Support
//
// Boots the real stack against a fresh in-memory SQLite database: the actual factory, the actual auth instance, and the
// actual boot orchestration (better-auth migrations + app migrations + admin bootstrap). No HTTP server, no mocks --
// specs drive the app with app.request and read state through the real Kysely handle.
//----------------------------------------------------------------------------------------------------------------------

import type { Hono } from 'hono';

// Resource Access
import { type DatabaseHandle, createDatabase } from '@server/resource-access/database/database.ts';
import { type Auth, type AuthExtras, createAuth } from '@server/resource-access/auth.ts';
import { initialize } from '@server/resource-access/boot.ts';

// App
import { createApp } from '@server/app.ts';

// Utils
import type { Config } from '@server/utils/config.ts';

//----------------------------------------------------------------------------------------------------------------------

export const ORIGIN = 'http://localhost:3000';

export function testConfig(overrides : Partial<Config> = {}) : Config
{
    return {
        HOST: '0.0.0.0',
        PORT: 3000,
        DATABASE_KIND: 'sqlite',
        DATABASE_PATH: ':memory:',
        DATABASE_URL: undefined,
        AUTH_SECRET: 'test-auth-secret-test-auth-secret-test',
        BASE_URL: ORIGIN,
        FILESHED_SETUP_TOKEN: undefined,
        STORAGE_ROOT: './data/blobs',
        GC_GRACE_DAYS: 7,
        GC_INTERVAL_MINUTES: 60,
        TRASH_PURGE_DAYS: 30,
        UPLOAD_MAX_BYTES: 5 * 1024 * 1024 * 1024,
        AVATAR_MAX_BYTES: 2 * 1024 * 1024,
        SMTP_HOST: undefined,
        SMTP_PORT: 587,
        SMTP_SECURE: false,
        SMTP_USER: undefined,
        SMTP_PASSWORD: undefined,
        SMTP_FROM: undefined,
        EMAIL_VERIFICATION_REQUIRED: false,
        ...overrides,
    };
}

//----------------------------------------------------------------------------------------------------------------------

export interface BootedApp
{
    config : Config;
    handle : DatabaseHandle;
    auth : Auth;
    app : Hono;
}

export async function bootTestApp(overrides : Partial<Config> = {}, extras : AuthExtras = {}) : Promise<BootedApp>
{
    const config = testConfig(overrides);
    const handle = createDatabase(config);
    const auth = createAuth(handle, config, extras);

    await initialize(handle, auth);

    return { config, handle, auth, app: createApp(auth) };
}

//----------------------------------------------------------------------------------------------------------------------
// HTTP helpers
//----------------------------------------------------------------------------------------------------------------------

export function signUp(app : Hono, email : string, password : string, name = 'Test User') : Promise<Response>
{
    return app.request(`${ ORIGIN }/api/auth/sign-up/email`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'origin': ORIGIN },
        body: JSON.stringify({ email, name, password }),
    });
}

export function signIn(app : Hono, email : string, password : string) : Promise<Response>
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

// Sign up, then flip the account to admin at the database. A fresh sign-in afterwards mints a session that reflects the
// promoted role (the sign-up cookie predates it).
export async function makeAdmin(booted : BootedApp, email : string, password : string) : Promise<string>
{
    await signUp(booted.app, email, password);
    await booted.handle.db.updateTable('user').set({ role: 'admin' })
        .where('email', '=', email)
        .execute();

    return cookieFrom(await signIn(booted.app, email, password));
}

//----------------------------------------------------------------------------------------------------------------------
