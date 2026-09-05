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

import { type AdminUserResponse, UNLIMITED_QUOTA } from '@fileshed/core';

// Managers
import { AdminManager } from '@server/managers/admin.ts';
import { SessionManager } from '@server/managers/session.ts';

// Resource Access
import { UserRA } from '@server/resource-access/users/index.ts';

// Routes
import { createAdminRoutes } from '@server/routes/admin.ts';

// Support
import { type BootedApp, ORIGIN, bootTestApp, cookieFrom, makeAdmin, signIn, signUp } from './support.ts';
import { type BootedBlobApp, bootBlobApp, claim, fileNodesForBlob, makeUser, putUpload } from '../blobs/support.ts';

//----------------------------------------------------------------------------------------------------------------------

const PASSWORD = 'correct-horse-battery';

async function setQuota(app : Hono, id : string, cookie : string | undefined, body : unknown) : Promise<Response>
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

// Sign up an admin on a blob-flow app, which has no admin bootstrap of its own: promote at the database, then sign in
// for a session that reflects the role.
async function adminOn(booted : BootedBlobApp) : Promise<string>
{
    await signUp(booted.app, 'root@example.com', PASSWORD);
    await booted.handle.db.updateTable('user').set({ role: 'admin' })
        .where('email', '=', 'root@example.com')
        .execute();

    return cookieFrom(await signIn(booted.app, 'root@example.com', PASSWORD));
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

describe('admin-set quota enforced by the blob upload flow', () =>
{
    let booted : BootedBlobApp;

    beforeEach(async () =>
    {
        booted = await bootBlobApp();
        const sessions = new SessionManager(booted.auth);
        booted.app.route('/api', createAdminRoutes(
            sessions,
            new AdminManager({
                auth: booted.auth,
                users: new UserRA(booted.handle),
                usage: async () => new Map(),
                defaultQuota: async () => UNLIMITED_QUOTA,
            })
        ));
    });

    afterEach(async () =>
    {
        await booted.cleanup();
    });

    it('refuses a capped user a claim that exceeds the admin-set limit', async () =>
    {
        const adminCookie = await adminOn(booted);

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

    // The cases that separate a live read from a cached one, and the reason they send `jar` rather than `cookie`: the
    // user signs in FIRST, so everything their browser holds predates the admin's change. The cap the admin has
    // already set is the answer, whatever the request carries. Both directions, because a live read that only ever
    // refuses is just a broken quota.
    it('refuses the next claim under a cap the admin lowered after the user signed in', async () =>
    {
        const adminCookie = await adminOn(booted);
        const capped = await makeUser(booted, 'capped@example.com', 1_000_000);

        expect((await setQuota(booted.app, capped.id, adminCookie, { quotaLimit: 4096 })).status).toBe(200);

        const res = await claim(booted.app, capped.jar, sha256Of(randomBytes(32)), 4097);
        const body = await res.json() as { error : string };

        expect(res.status).toBe(403);
        expect(body.error.toLowerCase()).toContain('quota');
    });

    it('admits the next claim under a cap the admin raised after the user signed in', async () =>
    {
        const adminCookie = await adminOn(booted);
        const capped = await makeUser(booted, 'capped@example.com', 4096);

        expect((await setQuota(booted.app, capped.id, adminCookie, { quotaLimit: 1_000_000 })).status).toBe(200);

        const res = await claim(booted.app, capped.jar, sha256Of(randomBytes(32)), 8192);
        const body = await res.json() as { upload : boolean; ticket : string };

        expect(res.status).toBe(200);
        expect(body.upload).toBe(true);
        expect(body.ticket).toBeTypeOf('string');
    });

    // The commit re-judges quota inside its transaction, and it must re-judge against the cap as it stands at commit
    // time: a cap lowered while the bytes were in flight refuses the write rather than letting an already-issued
    // ticket spend a limit that no longer exists.
    it('refuses a commit whose ticket was issued before the admin lowered the cap', async () =>
    {
        const adminCookie = await adminOn(booted);
        const capped = await makeUser(booted, 'capped@example.com', 1_000_000);
        const data = randomBytes(2048);

        const claimRes = await claim(booted.app, capped.jar, sha256Of(data), data.length);
        const { ticket } = await claimRes.json() as { ticket : string };

        expect((await setQuota(booted.app, capped.id, adminCookie, { quotaLimit: 1024 })).status).toBe(200);

        const res = await putUpload(booted.app, capped.jar, ticket, data);
        const body = await res.json() as { error : string };

        expect(res.status).toBe(403);
        expect(body.error.toLowerCase()).toContain('quota');
        // Nothing durable landed: the refusal rolled the whole commit back.
        expect(await fileNodesForBlob(booted.handle, sha256Of(data))).toHaveLength(0);
    });
});

//----------------------------------------------------------------------------------------------------------------------
// Every admin row states the cap the account is actually held to, with the instance default already folded in -- the
// same resolution the upload path enforces, so the listing can never disagree with what a user's next upload meets.
// The raw per-user column rides along beside it, because only the pair distinguishes "capped at 10 KB because someone
// said so" from "capped at 10 KB because the instance says so".
//----------------------------------------------------------------------------------------------------------------------

describe('effective quota on admin user rows', () =>
{
    let booted : BootedBlobApp;
    let adminCookie : string;
    let instanceDefault : number;

    beforeEach(async () =>
    {
        instanceDefault = UNLIMITED_QUOTA;
        booted = await bootBlobApp();
        booted.app.route('/api', createAdminRoutes(
            new SessionManager(booted.auth),
            new AdminManager({
                auth: booted.auth,
                users: new UserRA(booted.handle),
                usage: async () => new Map(),
                defaultQuota: async () => instanceDefault,
            })
        ));
        adminCookie = await adminOn(booted);
    });

    afterEach(async () =>
    {
        await booted.cleanup();
    });

    async function rowFor(email : string) : Promise<AdminUserResponse>
    {
        const res = await booted.app.request(`${ ORIGIN }/api/admin/users`, { headers: { cookie: adminCookie } });
        const body = await res.json() as { users : AdminUserResponse[] };
        const row = body.users.find((user) => user.email === email);

        if(row === undefined) { throw new Error(`No row for ${ email } in the admin listing.`); }

        return row;
    }

    it('reports an inheriting account as capped by the instance default, raw column still null', async () =>
    {
        instanceDefault = 10_000;
        await makeUser(booted, 'inherits@example.com');

        const row = await rowFor('inherits@example.com');

        expect(row.quotaLimit).toBe(null);
        expect(row.quotaEffective).toBe(10_000);
    });

    it('reports an account pinned to an explicit unlimited as uncapped under a capped default', async () =>
    {
        instanceDefault = 10_000;
        await makeUser(booted, 'pinned@example.com', UNLIMITED_QUOTA);

        const row = await rowFor('pinned@example.com');

        expect(row.quotaLimit).toBe(UNLIMITED_QUOTA);
        expect(row.quotaEffective).toBe(null);
    });

    it('keeps an explicit cap whatever the instance default says', async () =>
    {
        instanceDefault = 10_000;
        await makeUser(booted, 'capped@example.com', 4096);

        const row = await rowFor('capped@example.com');

        expect(row.quotaLimit).toBe(4096);
        expect(row.quotaEffective).toBe(4096);
    });

    it('reports an inheriting account as unlimited when the instance default is itself unlimited', async () =>
    {
        instanceDefault = UNLIMITED_QUOTA;
        await makeUser(booted, 'inherits@example.com');

        const row = await rowFor('inherits@example.com');

        expect(row.quotaLimit).toBe(null);
        expect(row.quotaEffective).toBe(null);
    });

    it('resolves the row a quota change answers with, not just the listing', async () =>
    {
        instanceDefault = 10_000;
        const target = await makeUser(booted, 'member@example.com', 4096);

        const res = await setQuota(booted.app, target.id, adminCookie, { quotaLimit: null });
        const body = await res.json() as AdminUserResponse;

        expect(res.status).toBe(200);
        expect(body.quotaLimit).toBe(null);
        expect(body.quotaEffective).toBe(10_000);
    });
});

//----------------------------------------------------------------------------------------------------------------------
