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
import type { DatabaseHandle } from '@server/resource-access/database/database.ts';

// Support
import { type BootedApp, ORIGIN, bootFullApp, cookieFrom, makeAdmin, signIn, signUp } from '../auth/support.ts';

//----------------------------------------------------------------------------------------------------------------------

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
    const booted = await bootFullApp();
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
