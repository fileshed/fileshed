//----------------------------------------------------------------------------------------------------------------------
// Preferences Route — PATCH /api/me/preferences
//
// A session-gated key-wise merge into the caller's preferences blob. Setting rootLabel updates it and the refreshed
// profile reflects it; a null rootLabel clears it. The blob's whole reason for being is that unknown keys survive a
// write -- proven here at the database, where a key seeded outside this version's vocabulary outlives a rootLabel
// patch. A malformed patch is a 400; no session is a 401.
//----------------------------------------------------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';

// Support
import { ORIGIN, bootTestApp, cookieFrom, signUp } from '../auth/support.ts';
import { composeNodeApp, userIDByEmail } from './support.ts';

//----------------------------------------------------------------------------------------------------------------------

function patchPreferences(app : ReturnType<typeof composeNodeApp>, cookie : string, body : unknown) : Promise<Response>
{
    return app.request(`${ ORIGIN }/api/me/preferences`, {
        method: 'PATCH',
        headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify(body),
    });
}

async function storedPreferences(booted : Awaited<ReturnType<typeof bootTestApp>>, userID : string) : Promise<unknown>
{
    const row = await booted.handle.db
        .selectFrom('user')
        .select('preferences')
        .where('id', '=', userID)
        .executeTakeFirstOrThrow();

    return JSON.parse(row.preferences ?? '{}');
}

//----------------------------------------------------------------------------------------------------------------------

describe('PATCH /api/me/preferences', () =>
{
    it('rejects a request with no session', async () =>
    {
        const booted = await bootTestApp();
        const app = composeNodeApp(booted);

        const res = await app.request(`${ ORIGIN }/api/me/preferences`, {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ rootLabel: 'Work' }),
        });

        expect(res.status).toBe(401);
    });

    it('rejects a rootLabel longer than 64 characters with 400', async () =>
    {
        const booted = await bootTestApp();
        const app = composeNodeApp(booted);
        const cookie = cookieFrom(await signUp(app, 'a@example.com', 'correct-horse-battery'));

        const res = await patchPreferences(app, cookie, { rootLabel: 'a'.repeat(65) });

        expect(res.status).toBe(400);
    });

    it('sets rootLabel and returns it on the refreshed profile', async () =>
    {
        const booted = await bootTestApp();
        const app = composeNodeApp(booted);
        const cookie = cookieFrom(await signUp(app, 'a@example.com', 'correct-horse-battery'));

        const res = await patchPreferences(app, cookie, { rootLabel: '  Photos  ' });
        const body = await res.json();

        expect(res.status).toBe(200);
        expect(body.preferences.rootLabel).toBe('Photos');

        const me = await app.request(`${ ORIGIN }/api/me`, { headers: { cookie } });
        expect((await me.json()).preferences.rootLabel).toBe('Photos');
    });

    it('clears rootLabel when the patch sets it to null', async () =>
    {
        const booted = await bootTestApp();
        const app = composeNodeApp(booted);
        const cookie = cookieFrom(await signUp(app, 'a@example.com', 'correct-horse-battery'));
        await patchPreferences(app, cookie, { rootLabel: 'Photos' });

        const res = await patchPreferences(app, cookie, { rootLabel: null });
        const body = await res.json();

        expect(res.status).toBe(200);
        expect(body.preferences.rootLabel).toBeUndefined();
    });

    // The forward-compat contract, asserted at the row: a key stored outside this version's vocabulary must survive a
    // patch of a known key. Seed it straight into the column, patch rootLabel, and read the raw blob back.
    it('preserves an unknown stored key across a rootLabel patch', async () =>
    {
        const booted = await bootTestApp();
        const app = composeNodeApp(booted);
        const cookie = cookieFrom(await signUp(app, 'a@example.com', 'correct-horse-battery'));
        const id = await userIDByEmail(booted, 'a@example.com');

        await booted.handle.db
            .updateTable('user')
            .set({ preferences: JSON.stringify({ theme: 'dark' }) })
            .where('id', '=', id)
            .execute();

        await patchPreferences(app, cookie, { rootLabel: 'Photos' });

        expect(await storedPreferences(booted, id)).toEqual({ theme: 'dark', rootLabel: 'Photos' });
    });
});

//----------------------------------------------------------------------------------------------------------------------
