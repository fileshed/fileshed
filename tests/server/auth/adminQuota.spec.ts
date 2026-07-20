//----------------------------------------------------------------------------------------------------------------------
// Admin Route — PATCH /api/admin/users/:id
//
// The admin quota surface: an admin sets or clears a user's byte cap. Pins the authn (401) / authz (403) / success
// (200) / validation (400) / not-found (404) contract, and proves an admin-set limit is real by watching the blob
// claim flow honour it -- a quota that is not persisted would let the capped user's claim through.
//----------------------------------------------------------------------------------------------------------------------

import { createHash, randomBytes } from 'node:crypto';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Hono } from 'hono';

// Managers
import { AdminManager } from '@server/managers/admin.ts';
import { SessionManager } from '@server/managers/session.ts';

// Routes
import { createAdminRoutes } from '@server/routes/admin.ts';

// Support
import { type BootedApp, ORIGIN, bootTestApp, cookieFrom, makeAdmin, signIn, signUp } from './support.ts';
import { type BootedBlobApp, bootBlobApp, claim } from '../blobs/support.ts';

//----------------------------------------------------------------------------------------------------------------------

const PASSWORD = 'correct-horse-battery';

function setQuota(app : Hono, id : string, cookie : string | undefined, body : unknown) : Promise<Response>
{
    const headers : Record<string, string> = { 'content-type': 'application/json' };
    if(cookie !== undefined) { headers['cookie'] = cookie; }

    return app.request(`${ ORIGIN }/api/admin/users/${ id }`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify(body),
    });
}

async function signUpUser(booted : BootedApp, email : string) : Promise<string>
{
    await signUp(booted.app, email, PASSWORD);
    const row = await booted.handle.db.selectFrom('user').select('id')
        .where('email', '=', email)
        .executeTakeFirstOrThrow();

    return row.id;
}

async function quotaByEmail(booted : BootedApp, email : string) : Promise<number | null>
{
    const row = await booted.handle.db.selectFrom('user').select('quota_limit')
        .where('email', '=', email)
        .executeTakeFirstOrThrow();

    return row.quota_limit;
}

//----------------------------------------------------------------------------------------------------------------------

describe('PATCH /api/admin/users/:id', () =>
{
    it('rejects an anonymous request with 401', async () =>
    {
        const booted = await bootTestApp();
        const targetID = await signUpUser(booted, 'member@example.com');

        const res = await setQuota(booted.app, targetID, undefined, { quotaLimit: 100 });

        expect(res.status).toBe(401);
    });

    it('rejects a signed-in non-admin with 403', async () =>
    {
        const booted = await bootTestApp();
        const targetID = await signUpUser(booted, 'target@example.com');
        const memberCookie = cookieFrom(await signIn(booted.app, 'target@example.com', PASSWORD));

        const res = await setQuota(booted.app, targetID, memberCookie, { quotaLimit: 100 });

        expect(res.status).toBe(403);
    });

    it('sets a finite limit for an admin and persists it to the user row', async () =>
    {
        const booted = await bootTestApp();
        const targetID = await signUpUser(booted, 'member@example.com');
        const adminCookie = await makeAdmin(booted, 'root@example.com', PASSWORD);

        const res = await setQuota(booted.app, targetID, adminCookie, { quotaLimit: 4096 });
        const body = await res.json() as { quotaLimit : number | null };

        expect(res.status).toBe(200);
        expect(body.quotaLimit).toBe(4096);
        expect(await quotaByEmail(booted, 'member@example.com')).toBe(4096);
    });

    it('clears a previously set limit to unlimited when given null', async () =>
    {
        const booted = await bootTestApp();
        const targetID = await signUpUser(booted, 'member@example.com');
        const adminCookie = await makeAdmin(booted, 'root@example.com', PASSWORD);

        await setQuota(booted.app, targetID, adminCookie, { quotaLimit: 4096 });
        expect(await quotaByEmail(booted, 'member@example.com')).toBe(4096);

        const res = await setQuota(booted.app, targetID, adminCookie, { quotaLimit: null });
        const body = await res.json() as { quotaLimit : number | null };

        expect(res.status).toBe(200);
        expect(body.quotaLimit).toBe(null);
        expect(await quotaByEmail(booted, 'member@example.com')).toBe(null);
    });

    it('rejects a negative limit with 400 and leaves the row unchanged', async () =>
    {
        const booted = await bootTestApp();
        const targetID = await signUpUser(booted, 'member@example.com');
        const adminCookie = await makeAdmin(booted, 'root@example.com', PASSWORD);

        await setQuota(booted.app, targetID, adminCookie, { quotaLimit: 4096 });

        const res = await setQuota(booted.app, targetID, adminCookie, { quotaLimit: -1 });

        expect(res.status).toBe(400);
        expect(await quotaByEmail(booted, 'member@example.com')).toBe(4096);
    });

    it('rejects a fractional limit with 400 and leaves the row unchanged', async () =>
    {
        const booted = await bootTestApp();
        const targetID = await signUpUser(booted, 'member@example.com');
        const adminCookie = await makeAdmin(booted, 'root@example.com', PASSWORD);

        await setQuota(booted.app, targetID, adminCookie, { quotaLimit: 4096 });

        const res = await setQuota(booted.app, targetID, adminCookie, { quotaLimit: 1.5 });

        expect(res.status).toBe(400);
        expect(await quotaByEmail(booted, 'member@example.com')).toBe(4096);
    });

    it('answers 404 for an unknown user id', async () =>
    {
        const booted = await bootTestApp();
        const adminCookie = await makeAdmin(booted, 'root@example.com', PASSWORD);

        const res = await setQuota(booted.app, 'no-such-user', adminCookie, { quotaLimit: 100 });

        expect(res.status).toBe(404);
    });
});

//----------------------------------------------------------------------------------------------------------------------
// A quota set through the admin endpoint is real: the blob claim path admits against the owner's quota, so a capped
// user's oversized claim must be refused. The session snapshots quota at sign-in, so the capped user signs in AFTER the
// admin sets the limit -- proving the endpoint wrote it, not the sign-up default.
//----------------------------------------------------------------------------------------------------------------------

function sha256Of(data : Buffer) : string
{
    return createHash('sha256')
        .update(data)
        .digest('hex');
}

describe('admin-set quota enforced by the blob claim flow', () =>
{
    let booted : BootedBlobApp;

    beforeEach(async () =>
    {
        booted = await bootBlobApp();
        const sessions = new SessionManager(booted.auth);
        booted.app.route('/api', createAdminRoutes(sessions, new AdminManager(booted.auth)));
    });

    afterEach(async () =>
    {
        await booted.cleanup();
    });

    it('refuses a capped user a claim that exceeds the admin-set limit', async () =>
    {
        await signUp(booted.app, 'root@example.com', PASSWORD);
        await booted.handle.db.updateTable('user').set({ role: 'admin' })
            .where('email', '=', 'root@example.com')
            .execute();
        const adminCookie = cookieFrom(await signIn(booted.app, 'root@example.com', PASSWORD));

        await signUp(booted.app, 'capped@example.com', PASSWORD);
        const targetRow = await booted.handle.db.selectFrom('user').select('id')
            .where('email', '=', 'capped@example.com')
            .executeTakeFirstOrThrow();

        const patchRes = await setQuota(booted.app, targetRow.id, adminCookie, { quotaLimit: 4096 });
        expect(patchRes.status).toBe(200);

        const cappedCookie = cookieFrom(await signIn(booted.app, 'capped@example.com', PASSWORD));
        const data = randomBytes(2048);

        const res = await claim(booted.app, cappedCookie, sha256Of(data), 4097);
        const body = await res.json() as { error : string };

        expect(res.status).toBe(403);
        expect(body.error.toLowerCase()).toContain('quota');
    });
});

//----------------------------------------------------------------------------------------------------------------------
