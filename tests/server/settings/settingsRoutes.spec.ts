//----------------------------------------------------------------------------------------------------------------------
// Admin Settings Routes — the read/patch surface and the live sign-up switch
//
// The contract over HTTP: /api/admin/settings is admin-only (401 without a session, 403 without the role); a patch
// applies live -- switching SIGN_UP_ENABLED off refuses the very next registration with no restart, and resetting
// the override reopens it just as fast; /api/instance tells the pre-auth pages the current state; and a value that
// does not fit its key is a 400 that stores nothing.
//----------------------------------------------------------------------------------------------------------------------

import { afterEach, describe, expect, it } from 'vitest';
import type { Hono } from 'hono';

import { adminSettingKeys, adminSettingsResponseCodec } from '@fileshed/core';

// Resource Access
import { BlobRA } from '@server/resource-access/blob/index.ts';
import { NodeRA } from '@server/resource-access/nodes/node.ts';
import { PublicLinkRA } from '@server/resource-access/publicLinks/index.ts';
import { ShareRA } from '@server/resource-access/shares/index.ts';
import { MediaTagsRA } from '@server/resource-access/mediaTags/index.ts';
import { UserRA } from '@server/resource-access/users/index.ts';
import { MailRA } from '@server/resource-access/mail/index.ts';
import { SettingsRA } from '@server/resource-access/settings/index.ts';
import { type DatabaseHandle, createDatabase } from '@server/resource-access/database/database.ts';
import { createAuth } from '@server/resource-access/auth.ts';
import { initialize } from '@server/resource-access/boot.ts';

// Managers
import { AdminManager } from '@server/managers/admin.ts';
import { AvatarManager } from '@server/managers/avatar.ts';
import { MailManager } from '@server/managers/mail.ts';
import { BlobManager } from '@server/managers/blob.ts';
import { DeletionOfferManager } from '@server/managers/deletionOffer.ts';
import { NodeManager } from '@server/managers/node.ts';
import { PublicLinkManager } from '@server/managers/publicLink.ts';
import { ShareManager } from '@server/managers/share.ts';
import { StatusManager } from '@server/managers/status.ts';
import { LastRunTracker } from '@server/managers/lastRun.ts';
import { MediaTagManager } from '@server/managers/mediaTags.ts';
import { SettingsManager } from '@server/managers/settings.ts';
import { SetupManager } from '@server/managers/setup.ts';
import { UserManager } from '@server/managers/user.ts';

// Utils
import { SecretBox } from '@server/utils/secretBox.ts';

// App
import { createApp } from '@server/app.ts';

// Support
import { type BootedApp, ORIGIN, cookieFrom, makeAdmin, signIn, signUp, testConfig } from '../auth/support.ts';

//----------------------------------------------------------------------------------------------------------------------

// The bootApp composition in miniature: full services over an in-memory database, with the settings manager feeding
// the app's own instance, so a patch through the route is what the gate middleware reads.
async function bootSettingsApp() : Promise<BootedApp>
{
    const config = testConfig();
    const handle = createDatabase(config);
    const auth = createAuth(handle, config);

    await initialize(handle, auth);

    const blob = new BlobRA(handle);
    const nodeRA = new NodeRA(handle);
    const shareRA = new ShareRA(handle);
    const userRA = new UserRA(handle);
    const nodes = new NodeManager(handle, nodeRA, blob);
    const settings = new SettingsManager({
        settings: new SettingsRA(handle),
        config,
        box: new SecretBox(config.AUTH_SECRET),
        startedAt: new Date(),
    });

    const app = createApp(auth, {
        blobs: new BlobManager({ handle, blob, uploadMaxBytes: async () => config.UPLOAD_MAX_BYTES }),
        mediaTags: new MediaTagManager({ blob, tags: new MediaTagsRA(handle) }),
        setup: new SetupManager({ auth, handle, users: userRA, operatorToken: null }),
        avatars: new AvatarManager({ handle, blob, avatarMaxBytes: async () => config.AVATAR_MAX_BYTES }),
        nodes,
        shares: new ShareManager(handle, nodeRA, shareRA, userRA),
        publicLinks: new PublicLinkManager(nodeRA, blob, new PublicLinkRA(handle), (userID, nodeID) =>
            shareRA.effectiveRole(userID, nodeID)),
        deletionOffers: new DeletionOfferManager(handle, nodes),
        adminStatus: new StatusManager(blob, new LastRunTracker()),
        users: new UserManager(userRA),
        settings,
        admins: new AdminManager({ auth, usage: (ownerIDs) => nodeRA.ownedBytesByOwner(ownerIDs) }),
        mail: new MailManager({ settings, mail: new MailRA(), appName: 'FileShed' }),
    });

    return { config, handle, auth, app };
}

function getSettings(app : Hono, cookie ?: string) : Promise<Response>
{
    return app.request(`${ ORIGIN }/api/admin/settings`, { headers: cookie ? { cookie } : {} });
}

function patchSettings(app : Hono, cookie : string, changes : Record<string, unknown>) : Promise<Response>
{
    return app.request(`${ ORIGIN }/api/admin/settings`, {
        method: 'PATCH',
        headers: { cookie, 'content-type': 'application/json', 'origin': ORIGIN },
        body: JSON.stringify({ changes }),
    });
}

async function instanceSignUpEnabled(app : Hono) : Promise<boolean>
{
    const res = await app.request(`${ ORIGIN }/api/instance`);
    const body = await res.json() as { signUpEnabled : boolean };

    return body.signUpEnabled;
}

//----------------------------------------------------------------------------------------------------------------------

const handles : DatabaseHandle[] = [];

async function boot() : Promise<BootedApp>
{
    const booted = await bootSettingsApp();
    handles.push(booted.handle);

    return booted;
}

afterEach(async () =>
{
    await Promise.all(handles.splice(0).map((handle) => handle.db.destroy()));
});

//----------------------------------------------------------------------------------------------------------------------

describe('GET /api/admin/settings', () =>
{
    it('requires a session and the admin role', async () =>
    {
        const booted = await boot();
        await signUp(booted.app, 'user@example.com', 'correct-horse-battery');
        const userCookie = cookieFrom(await signIn(booted.app, 'user@example.com', 'correct-horse-battery'));

        expect((await getSettings(booted.app)).status).toBe(401);
        expect((await getSettings(booted.app, userCookie)).status).toBe(403);
    });

    it('answers every vocabulary key at its default on a fresh instance', async () =>
    {
        const booted = await boot();
        const cookie = await makeAdmin(booted, 'root@example.com', 'correct-horse-battery');

        const res = await getSettings(booted.app, cookie);
        expect(res.status).toBe(200);

        const body = adminSettingsResponseCodec.parse(await res.json());
        expect(body.settings.map((entry) => entry.key).sort()).toEqual([ ...adminSettingKeys ].sort());
        expect(body.settings.every((entry) => entry.source === 'default')).toBe(true);
        expect(body.restartRequired).toBe(false);
    });
});

//----------------------------------------------------------------------------------------------------------------------

describe('PATCH /api/admin/settings', () =>
{
    it('switching SIGN_UP_ENABLED off refuses the very next registration, with no restart', async () =>
    {
        const booted = await boot();
        const cookie = await makeAdmin(booted, 'root@example.com', 'correct-horse-battery');

        const res = await patchSettings(booted.app, cookie, { SIGN_UP_ENABLED: false });
        expect(res.status).toBe(200);

        const refused = await signUp(booted.app, 'late@example.com', 'correct-horse-battery');
        expect(refused.status).toBe(403);
        expect(await instanceSignUpEnabled(booted.app)).toBe(false);

        const users = await booted.handle.db.selectFrom('user').select('email')
            .execute();
        expect(users.map((row) => row.email)).toEqual([ 'root@example.com' ]);
    });

    it('blocks evasion spellings of the sign-up path while switched off', async () =>
    {
        const booted = await boot();
        const cookie = await makeAdmin(booted, 'root@example.com', 'correct-horse-battery');
        await patchSettings(booted.app, cookie, { SIGN_UP_ENABLED: false });

        for(const path of [ '/api/auth//sign-up/email', '/api/auth/SIGN-UP/email', '/api/auth/sign-up%2Femail' ])
        {
            // eslint-disable-next-line no-await-in-loop -- sequential by nature, three variants
            const res = await booted.app.request(`${ ORIGIN }${ path }`, {
                method: 'POST',
                headers: { 'content-type': 'application/json', 'origin': ORIGIN },
                body: JSON.stringify({ email: 'evader@example.com', name: 'E', password: 'correct-horse-battery' }),
            });
            expect(res.status, path).toBe(403);
        }
    });

    it('resetting the override to null reopens sign-up just as live', async () =>
    {
        const booted = await boot();
        const cookie = await makeAdmin(booted, 'root@example.com', 'correct-horse-battery');
        await patchSettings(booted.app, cookie, { SIGN_UP_ENABLED: false });

        const res = await patchSettings(booted.app, cookie, { SIGN_UP_ENABLED: null });
        expect(res.status).toBe(200);

        expect(await instanceSignUpEnabled(booted.app)).toBe(true);
        expect((await signUp(booted.app, 'late@example.com', 'correct-horse-battery')).status).toBe(200);
    });

    it('rejects a value that does not fit its key with a 400, storing nothing', async () =>
    {
        const booted = await boot();
        const cookie = await makeAdmin(booted, 'root@example.com', 'correct-horse-battery');

        const res = await patchSettings(booted.app, cookie, { SIGN_UP_ENABLED: 'nope' });
        expect(res.status).toBe(400);

        expect(await instanceSignUpEnabled(booted.app)).toBe(true);
    });

    it('answers the refreshed view, override marked, so the UI needs no second round trip', async () =>
    {
        const booted = await boot();
        const cookie = await makeAdmin(booted, 'root@example.com', 'correct-horse-battery');

        const res = await patchSettings(booted.app, cookie, { UPLOAD_MAX_BYTES: 1024 });
        const body = adminSettingsResponseCodec.parse(await res.json());
        const entry = body.settings.find((row) => row.key === 'UPLOAD_MAX_BYTES');

        expect(entry).toMatchObject({ value: 1024, source: 'override' });
        expect(body.restartRequired).toBe(false);
    });
});

//----------------------------------------------------------------------------------------------------------------------
