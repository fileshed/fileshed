//----------------------------------------------------------------------------------------------------------------------
// Branding Routes — the admin theme surface and the stylesheet everyone loads
//
// Over HTTP: /api/admin/branding is admin-only in both directions; /api/branding.css is anonymous, serves
// text/css with an ETag, answers 304 to a matching If-None-Match, and reflects a saved theme on the very next
// request -- no restart anywhere. /api/instance carries the live branding facts the pre-auth pages need, and a
// renamed instance shows up there immediately.
//----------------------------------------------------------------------------------------------------------------------

import { afterEach, describe, expect, it } from 'vitest';
import type { Hono } from 'hono';

import { instanceThemeCodec } from '@fileshed/core';

// Resource Access
import type { DatabaseHandle } from '@server/resource-access/database/database.ts';

// Support
import { type BootedApp, ORIGIN, bootFullApp, cookieFrom, makeAdmin, signIn, signUp } from '../auth/support.ts';

//----------------------------------------------------------------------------------------------------------------------

async function getBranding(app : Hono, cookie ?: string) : Promise<Response>
{
    return app.request(`${ ORIGIN }/api/admin/branding`, { headers: cookie ? { cookie } : {} });
}

async function patchBranding(app : Hono, cookie : string, patch : Record<string, unknown>) : Promise<Response>
{
    return app.request(`${ ORIGIN }/api/admin/branding`, {
        method: 'PATCH',
        headers: { cookie, 'content-type': 'application/json', 'origin': ORIGIN },
        body: JSON.stringify(patch),
    });
}

async function getCss(app : Hono, etag ?: string) : Promise<Response>
{
    return app.request(`${ ORIGIN }/api/branding.css`, { headers: etag ? { 'if-none-match': etag } : {} });
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

describe('/api/admin/branding', () =>
{
    it('requires a session and the admin role in both directions', async () =>
    {
        const booted = await boot();
        await signUp(booted.app, 'user@example.com', 'correct-horse-battery');
        const userCookie = cookieFrom(await signIn(booted.app, 'user@example.com', 'correct-horse-battery'));

        expect((await getBranding(booted.app)).status).toBe(401);
        expect((await getBranding(booted.app, userCookie)).status).toBe(403);
        expect((await patchBranding(booted.app, userCookie, { primary: '#3b82f6' })).status).toBe(403);
        expect((await booted.app.request(`${ ORIGIN }/api/admin/branding/logo`, { method: 'POST', body: 'x' }))
            .status).toBe(401);
    });

    it('answers 404 for the anonymous logo route while none is set', async () =>
    {
        const booted = await boot();

        expect((await booted.app.request(`${ ORIGIN }/api/branding/logo`)).status).toBe(404);
    });

    it('answers the stock document on a fresh instance and the merged document after a patch', async () =>
    {
        const booted = await boot();
        const cookie = await makeAdmin(booted, 'root@example.com', 'correct-horse-battery');

        const fresh = instanceThemeCodec.parse(await (await getBranding(booted.app, cookie)).json());
        expect(fresh.primary).toBeNull();

        await patchBranding(booted.app, cookie, { primary: '#3b82f6' });
        const merged = instanceThemeCodec.parse(
            await (await patchBranding(booted.app, cookie, { radius: 0.5 })).json()
        );

        expect(merged.primary).toBe('#3b82f6');
        expect(merged.radius).toBe(0.5);
    });

    it('rejects a value that does not fit, storing nothing', async () =>
    {
        const booted = await boot();
        const cookie = await makeAdmin(booted, 'root@example.com', 'correct-horse-battery');

        expect((await patchBranding(booted.app, cookie, { primary: 'red' })).status).toBe(400);

        const doc = instanceThemeCodec.parse(await (await getBranding(booted.app, cookie)).json());
        expect(doc.primary).toBeNull();
    });
});

//----------------------------------------------------------------------------------------------------------------------

describe('GET /api/branding.css', () =>
{
    it('serves anonymously as text/css, empty while the theme is stock', async () =>
    {
        const booted = await boot();

        const res = await getCss(booted.app);
        expect(res.status).toBe(200);
        expect(res.headers.get('content-type')).toContain('text/css');
        expect(await res.text()).toBe('');
    });

    it('reflects a saved theme on the very next anonymous request, no restart', async () =>
    {
        const booted = await boot();
        const cookie = await makeAdmin(booted, 'root@example.com', 'correct-horse-battery');

        await patchBranding(booted.app, cookie, { primary: '#3b82f6', customCSS: '.x { color: red; }' });

        const css = await (await getCss(booted.app)).text();
        expect(css).toContain('--ui-color-primary-500: #3b82f6;');
        expect(css).toContain('.x { color: red; }');
    });

    it('answers 304 to a matching If-None-Match and 200 with a new ETag after a change', async () =>
    {
        const booted = await boot();
        const cookie = await makeAdmin(booted, 'root@example.com', 'correct-horse-battery');

        const first = await getCss(booted.app);
        const etag = first.headers.get('etag');
        expect(etag).not.toBeNull();

        expect((await getCss(booted.app, etag ?? '')).status).toBe(304);

        await patchBranding(booted.app, cookie, { primary: '#3b82f6' });
        const changed = await getCss(booted.app, etag ?? '');
        expect(changed.status).toBe(200);
        expect(changed.headers.get('etag')).not.toBe(etag);
    });
});

//----------------------------------------------------------------------------------------------------------------------

describe('/api/instance branding facts', () =>
{
    it('answers the stock facts on a fresh instance and the live values after saves', async () =>
    {
        const booted = await boot();
        const cookie = await makeAdmin(booted, 'root@example.com', 'correct-horse-battery');

        const fresh = await (await booted.app.request(`${ ORIGIN }/api/instance`)).json() as
            { branding : Record<string, unknown> };
        expect(fresh.branding).toEqual({ instanceName: 'FileShed', mode: 'system', forcedMode: false, logo: null });

        await booted.app.request(`${ ORIGIN }/api/admin/settings`, {
            method: 'PATCH',
            headers: { cookie, 'content-type': 'application/json', 'origin': ORIGIN },
            body: JSON.stringify({ changes: { INSTANCE_NAME: 'Morgul Vale Files' } }),
        });
        await patchBranding(booted.app, cookie, { mode: 'dark', forcedMode: true });

        const after = await (await booted.app.request(`${ ORIGIN }/api/instance`)).json() as
            { branding : Record<string, unknown> };
        expect(after.branding).toEqual({
            instanceName: 'Morgul Vale Files',
            mode: 'dark',
            forcedMode: true,
            logo: null,
        });
    });
});

//----------------------------------------------------------------------------------------------------------------------
