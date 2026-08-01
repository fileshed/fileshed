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
import { BlobRA } from '@server/resource-access/blob/index.ts';
import { MailRA } from '@server/resource-access/mail/index.ts';
import { MediaTagsRA } from '@server/resource-access/mediaTags/index.ts';
import { NodeRA } from '@server/resource-access/nodes/node.ts';
import { PublicLinkRA } from '@server/resource-access/publicLinks/index.ts';
import { SettingsRA } from '@server/resource-access/settings/index.ts';
import { ShareRA } from '@server/resource-access/shares/index.ts';
import { UserRA } from '@server/resource-access/users/index.ts';

// Managers
import { AdminManager } from '@server/managers/admin.ts';
import { AvatarManager } from '@server/managers/avatar.ts';
import { BlobManager } from '@server/managers/blob.ts';
import { BrandingManager } from '@server/managers/branding.ts';
import { DeletionOfferManager } from '@server/managers/deletionOffer.ts';
import { LastRunTracker } from '@server/managers/lastRun.ts';
import { MailManager } from '@server/managers/mail.ts';
import { MediaTagManager } from '@server/managers/mediaTags.ts';
import { NodeManager } from '@server/managers/node.ts';
import { PublicLinkManager } from '@server/managers/publicLink.ts';
import { SettingsManager } from '@server/managers/settings.ts';
import { SetupManager } from '@server/managers/setup.ts';
import { ShareManager } from '@server/managers/share.ts';
import { StatusManager } from '@server/managers/status.ts';
import { UserManager } from '@server/managers/user.ts';

// App
import { createApp } from '@server/app.ts';

// Utils
import type { Config } from '@server/utils/config.ts';
import { SecretBox } from '@server/utils/secretBox.ts';
import { VERSION } from '@server/utils/version.ts';

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
        FILESHED_SAFE_THEME: false,
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
// Full composition
//----------------------------------------------------------------------------------------------------------------------

// bootApp's service composition in miniature: every manager over the one handle, with the settings manager feeding
// the app's own instance -- so a patch through a route is what the gate middleware reads. Composition alone touches
// neither the database nor the storage root, which is what lets the route-table and OpenAPI specs use it unmigrated.
export function composeFullApp(auth : Auth, handle : DatabaseHandle, config : Config) : Hono
{
    const blob = new BlobRA(handle);
    const nodeRA = new NodeRA(handle);
    const shareRA = new ShareRA(handle);
    const userRA = new UserRA(handle);
    const settingsRA = new SettingsRA(handle);

    const startedAt = new Date();
    const nodes = new NodeManager(handle, nodeRA, blob);
    const settings = new SettingsManager({
        settings: settingsRA,
        config,
        box: new SecretBox(config.AUTH_SECRET),
        startedAt,
    });
    const mail = new MailManager({ settings, mail: new MailRA() });

    return createApp(auth, {
        blobs: new BlobManager({ handle, blob, uploadMaxBytes: async () => config.UPLOAD_MAX_BYTES }),
        mediaTags: new MediaTagManager({ blob, tags: new MediaTagsRA(handle) }),
        setup: new SetupManager({ auth, handle, users: userRA, operatorToken: null }),
        avatars: new AvatarManager({ handle, blob, avatarMaxBytes: async () => config.AVATAR_MAX_BYTES }),
        nodes,
        shares: new ShareManager(handle, nodeRA, shareRA, userRA),
        publicLinks: new PublicLinkManager(nodeRA, blob, new PublicLinkRA(handle), (userID, nodeID) =>
            shareRA.effectiveRole(userID, nodeID)),
        deletionOffers: new DeletionOfferManager(handle, nodes),
        adminStatus: new StatusManager({
            blob,
            nodes: nodeRA,
            users: userRA,
            shares: shareRA,
            tracker: new LastRunTracker(),
            version: VERSION,
            databaseKind: handle.kind,
            startedAt,
            activeProviders: 0,
            emailEnabled: () => mail.isConfigured(),
            signUpEnabled: () => settings.booleanValue('SIGN_UP_ENABLED', true),
        }),
        users: new UserManager(userRA),
        settings,
        branding: new BrandingManager({
            settings: settingsRA,
            config,
            handle,
            blob,
            maxBytes: async () => config.AVATAR_MAX_BYTES,
        }),
        admins: new AdminManager({ auth, usage: (ownerIDs) => nodeRA.ownedBytesByOwner(ownerIDs) }),
        mail,
        providers: [],
    });
}

// The fully-serviced counterpart to bootTestApp, for specs that drive real requests through the whole app.
export async function bootFullApp(overrides : Partial<Config> = {}) : Promise<BootedApp>
{
    const config = testConfig(overrides);
    const handle = createDatabase(config);
    const auth = createAuth(handle, config);

    await initialize(handle, auth);

    return { config, handle, auth, app: composeFullApp(auth, handle, config) };
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
