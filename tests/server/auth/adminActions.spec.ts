//----------------------------------------------------------------------------------------------------------------------
// Admin Routes — user management actions (ban, unban, role, password, revoke-sessions)
//
// The contract over HTTP, against the real auth stack: a ban refuses the target's next sign-in and destroys their
// session rows; an unban lets them back in with the ban trio cleared; a role change promotes or demotes anyone
// EXCEPT the caller demoting themselves; a password set is the no-email reset (old refused, new works, existing
// sessions deliberately untouched); revoke-sessions empties the target's session rows. Every action is admin-only
// and answers 404 for a user that does not exist.
//----------------------------------------------------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';
import type { Hono } from 'hono';
import { sql } from 'kysely';

// Support
import { type BootedApp, ORIGIN, bootTestApp, cookieFrom, makeAdmin, signIn, signUp } from './support.ts';

//----------------------------------------------------------------------------------------------------------------------

const PASSWORD = 'correct-horse-battery';

async function action(app : Hono, path : string, cookie ?: string, body ?: unknown) : Promise<Response>
{
    return app.request(`${ ORIGIN }${ path }`, {
        method: 'POST',
        headers: {
            ...cookie ? { cookie } : {},
            'content-type': 'application/json',
            'origin': ORIGIN,
        },
        body: JSON.stringify(body ?? {}),
    });
}

async function idOf(booted : BootedApp, email : string) : Promise<string>
{
    const row = await booted.handle.db.selectFrom('user').select('id')
        .where('email', '=', email)
        .executeTakeFirstOrThrow();

    return row.id;
}

// The session table is better-auth territory (camelCase columns, outside the typed schema), so the count goes
// through raw SQL, the same way the ban hooks reach the apikey table.
async function sessionCountOf(booted : BootedApp, userID : string) : Promise<number>
{
    const result = await sql`select count(*) as total from session where "userId" = ${ userID }`
        .execute(booted.handle.db);
    const row = result.rows[0] as { total : string | number };

    return Number(row.total);
}

// A booted app with an admin and one signed-in member, the fixture every action starts from.
async function bootWithMember() : Promise<{ booted : BootedApp; adminCookie : string; memberID : string }>
{
    const booted = await bootTestApp();
    await signUp(booted.app, 'member@example.com', PASSWORD);
    const adminCookie = await makeAdmin(booted, 'root@example.com', PASSWORD);

    return { booted, adminCookie, memberID: await idOf(booted, 'member@example.com') };
}

//----------------------------------------------------------------------------------------------------------------------

describe('POST /api/admin/users/:id/ban', () =>
{
    it('bans with reason and expiry, destroys the target\'s sessions, and refuses their next sign-in', async () =>
    {
        const { booted, adminCookie, memberID } = await bootWithMember();
        await signIn(booted.app, 'member@example.com', PASSWORD);
        expect(await sessionCountOf(booted, memberID)).toBeGreaterThan(0);

        const res = await action(
            booted.app, 
            `/api/admin/users/${ memberID }/ban`, 
            adminCookie,
            { reason: 'Spamming', expiresInDays: 7 }
        );
        const row = await res.json();

        expect(res.status).toBe(200);
        expect(row.banned).toBe(true);
        expect(row.banReason).toBe('Spamming');
        expect(typeof row.banExpires).toBe('string');

        expect(await sessionCountOf(booted, memberID)).toBe(0);
        expect((await signIn(booted.app, 'member@example.com', PASSWORD)).status).toBe(403);
    });

    it('bans without expiry as until-lifted', async () =>
    {
        const { booted, adminCookie, memberID } = await bootWithMember();

        const res = await action(booted.app, `/api/admin/users/${ memberID }/ban`, adminCookie, {});
        const row = await res.json();

        expect(row.banned).toBe(true);
        expect(row.banExpires).toBeNull();
    });

    it('refuses a self-ban with 400', async () =>
    {
        const { booted, adminCookie } = await bootWithMember();
        const adminID = await idOf(booted, 'root@example.com');

        const res = await action(booted.app, `/api/admin/users/${ adminID }/ban`, adminCookie, {});

        expect(res.status).toBe(400);
    });

    it('is admin-only: 401 anonymous, 403 for a member', async () =>
    {
        const { booted, memberID } = await bootWithMember();
        const memberCookie = cookieFrom(await signIn(booted.app, 'member@example.com', PASSWORD));

        expect((await action(booted.app, `/api/admin/users/${ memberID }/ban`)).status).toBe(401);
        expect((await action(booted.app, `/api/admin/users/${ memberID }/ban`, memberCookie)).status).toBe(403);
    });

    it('answers 404 for a user that does not exist', async () =>
    {
        const { booted, adminCookie } = await bootWithMember();

        expect((await action(booted.app, '/api/admin/users/nope/ban', adminCookie, {})).status).toBe(404);
    });
});

//----------------------------------------------------------------------------------------------------------------------

describe('lapsed bans', () =>
{
    // The row keeps banned = true after a dated ban expires (better-auth only clears it on the user's next sign-in
    // attempt), so the admin surface must derive standing rather than echo the flag.
    it('reads a dated ban past its expiry as a clean record in the admin list', async () =>
    {
        const { booted, adminCookie, memberID } = await bootWithMember();
        await action(
            booted.app, 
            `/api/admin/users/${ memberID }/ban`, 
            adminCookie,
            { reason: 'Spamming', expiresInDays: 1 }
        );

        await booted.handle.db.updateTable('user')
            .set({ banExpires: new Date(Date.now() - 60_000).toISOString() })
            .where('id', '=', memberID)
            .execute();

        const res = await booted.app.request(`${ ORIGIN }/api/admin/users`, { headers: { cookie: adminCookie } });
        const body = await res.json();
        const member = body.users.find((user : { id : string }) => user.id === memberID);

        expect(res.status).toBe(200);
        expect(member.banned).toBe(false);
        expect(member.banReason).toBeNull();
        expect(member.banExpires).toBeNull();
    });

    // Deliberately pins better-auth's own sign-in gate, not our code. The ban engine exists because the library
    // honors a lapsed expiry at sign-in while leaving the banned flag set on the row, so the admin surface has to
    // derive standing itself. A library bump that changed either half would leave that surface silently wrong.
    it('lets the user sign back in once the ban has expired', async () =>
    {
        const { booted, adminCookie, memberID } = await bootWithMember();
        await action(booted.app, `/api/admin/users/${ memberID }/ban`, adminCookie, { expiresInDays: 1 });
        expect((await signIn(booted.app, 'member@example.com', PASSWORD)).status).toBe(403);

        await booted.handle.db.updateTable('user')
            .set({ banExpires: new Date(Date.now() - 60_000).toISOString() })
            .where('id', '=', memberID)
            .execute();

        expect((await signIn(booted.app, 'member@example.com', PASSWORD)).status).toBe(200);
    });

    it('keeps a ban with a future expiry fully in force on the admin list', async () =>
    {
        const { booted, adminCookie, memberID } = await bootWithMember();
        await action(
            booted.app, 
            `/api/admin/users/${ memberID }/ban`, 
            adminCookie,
            { reason: 'Spamming', expiresInDays: 7 }
        );

        const res = await booted.app.request(`${ ORIGIN }/api/admin/users`, { headers: { cookie: adminCookie } });
        const body = await res.json();
        const member = body.users.find((user : { id : string }) => user.id === memberID);

        expect(member.banned).toBe(true);
        expect(member.banReason).toBe('Spamming');
        expect(typeof member.banExpires).toBe('string');
    });
});

//----------------------------------------------------------------------------------------------------------------------

describe('POST /api/admin/users/:id/unban', () =>
{
    it('lifts the ban, clears the trio, and the user signs in again', async () =>
    {
        const { booted, adminCookie, memberID } = await bootWithMember();
        await action(booted.app, `/api/admin/users/${ memberID }/ban`, adminCookie, { reason: 'Oops' });

        const res = await action(booted.app, `/api/admin/users/${ memberID }/unban`, adminCookie);
        const row = await res.json();

        expect(res.status).toBe(200);
        expect(row.banned).toBe(false);
        expect(row.banReason).toBeNull();
        expect(row.banExpires).toBeNull();
        expect((await signIn(booted.app, 'member@example.com', PASSWORD)).status).toBe(200);
    });
});

//----------------------------------------------------------------------------------------------------------------------

describe('POST /api/admin/users/:id/role', () =>
{
    it('promotes a member to admin and demotes them back', async () =>
    {
        const { booted, adminCookie, memberID } = await bootWithMember();

        const promoted = await action(
            booted.app, 
            `/api/admin/users/${ memberID }/role`, 
            adminCookie,
            { role: 'admin' }
        );
        expect((await promoted.json()).role).toBe('admin');

        const demoted = await action(
            booted.app, 
            `/api/admin/users/${ memberID }/role`, 
            adminCookie,
            { role: 'user' }
        );
        expect((await demoted.json()).role).toBe('user');
    });

    it('refuses the caller demoting themselves, leaving their role intact', async () =>
    {
        const { booted, adminCookie } = await bootWithMember();
        const adminID = await idOf(booted, 'root@example.com');

        const res = await action(booted.app, `/api/admin/users/${ adminID }/role`, adminCookie, { role: 'user' });

        expect(res.status).toBe(400);
        const row = await booted.handle.db.selectFrom('user').select('role')
            .where('id', '=', adminID)
            .executeTakeFirstOrThrow();
        expect(row.role).toBe('admin');
    });

    it('rejects a role outside the vocabulary with 400', async () =>
    {
        const { booted, adminCookie, memberID } = await bootWithMember();

        const res = await action(
            booted.app, 
            `/api/admin/users/${ memberID }/role`, 
            adminCookie,
            { role: 'superuser' }
        );

        expect(res.status).toBe(400);
    });
});

//----------------------------------------------------------------------------------------------------------------------

describe('POST /api/admin/users/:id/password', () =>
{
    it('sets a new password: the old one is refused, the new one signs in', async () =>
    {
        const { booted, adminCookie, memberID } = await bootWithMember();

        const res = await action(
            booted.app, 
            `/api/admin/users/${ memberID }/password`, 
            adminCookie,
            { password: 'a-brand-new-password' }
        );

        expect(res.status).toBe(204);
        expect((await signIn(booted.app, 'member@example.com', PASSWORD)).status).not.toBe(200);
        expect((await signIn(booted.app, 'member@example.com', 'a-brand-new-password')).status).toBe(200);
    });

    it('leaves the target\'s existing sessions alive -- revoking is its own action', async () =>
    {
        const { booted, adminCookie, memberID } = await bootWithMember();
        await signIn(booted.app, 'member@example.com', PASSWORD);
        const before = await sessionCountOf(booted, memberID);

        await action(
            booted.app, 
            `/api/admin/users/${ memberID }/password`, 
            adminCookie,
            { password: 'a-brand-new-password' }
        );

        expect(await sessionCountOf(booted, memberID)).toBe(before);
    });

    it('rejects a password below the floor with 400', async () =>
    {
        const { booted, adminCookie, memberID } = await bootWithMember();

        const res = await action(
            booted.app, 
            `/api/admin/users/${ memberID }/password`, 
            adminCookie,
            { password: 'short' }
        );

        expect(res.status).toBe(400);
    });
});

//----------------------------------------------------------------------------------------------------------------------

describe('POST /api/admin/users/:id/revoke-sessions', () =>
{
    it('destroys every session row the target holds', async () =>
    {
        const { booted, adminCookie, memberID } = await bootWithMember();
        await signIn(booted.app, 'member@example.com', PASSWORD);
        await signIn(booted.app, 'member@example.com', PASSWORD);
        expect(await sessionCountOf(booted, memberID)).toBeGreaterThanOrEqual(2);

        const res = await action(booted.app, `/api/admin/users/${ memberID }/revoke-sessions`, adminCookie);

        expect(res.status).toBe(204);
        expect(await sessionCountOf(booted, memberID)).toBe(0);
    });
});

//----------------------------------------------------------------------------------------------------------------------

describe('GET /api/admin/users — search and sort', () =>
{
    it('filters by email substring and by name when asked', async () =>
    {
        const booted = await bootTestApp();
        await signUp(booted.app, 'alice@example.com', PASSWORD, 'Alice');
        await signUp(booted.app, 'bob@other.test', PASSWORD, 'Bob');
        const adminCookie = await makeAdmin(booted, 'root@example.com', PASSWORD);

        const byEmail = await booted.app.request(
            `${ ORIGIN }/api/admin/users?search=other.test`,
            { headers: { cookie: adminCookie } }
        );
        const emailPage = await byEmail.json();
        expect(emailPage.users.map((user : { email : string }) => user.email)).toEqual([ 'bob@other.test' ]);

        const byName = await booted.app.request(
            `${ ORIGIN }/api/admin/users?search=Ali&searchField=name`,
            { headers: { cookie: adminCookie } }
        );
        const namePage = await byName.json();
        expect(namePage.users.map((user : { email : string }) => user.email)).toEqual([ 'alice@example.com' ]);
    });

    // An admin who types the address the way a person writes it still finds the account. Matching on the stored text
    // answers this differently per deployment: SQLite's LIKE ignores ASCII case, Postgres's does not.
    it('finds an account however the search was capitalized', async () =>
    {
        const booted = await bootTestApp();
        await signUp(booted.app, 'bob@example.com', PASSWORD, 'Bob');
        await signUp(booted.app, 'carol@other.test', PASSWORD, 'Carol');
        const adminCookie = await makeAdmin(booted, 'root@example.com', PASSWORD);

        const res = await booted.app.request(
            `${ ORIGIN }/api/admin/users?search=Bob@`,
            { headers: { cookie: adminCookie } }
        );
        const page = await res.json();

        expect(page.users.map((user : { email : string }) => user.email)).toEqual([ 'bob@example.com' ]);
        expect(page.total).toBe(1);
    });

    it('sorts by the requested key and direction', async () =>
    {
        const booted = await bootTestApp();
        await signUp(booted.app, 'bbb@example.com', PASSWORD, 'Bee');
        await signUp(booted.app, 'aaa@example.com', PASSWORD, 'Aye');
        const adminCookie = await makeAdmin(booted, 'zzz@example.com', PASSWORD);

        const res = await booted.app.request(
            `${ ORIGIN }/api/admin/users?sortBy=email&sortDirection=desc`,
            { headers: { cookie: adminCookie } }
        );
        const page = await res.json();

        expect(page.users.map((user : { email : string }) => user.email))
            .toEqual([ 'zzz@example.com', 'bbb@example.com', 'aaa@example.com' ]);
    });

    // Dropping the unrecognized key has to leave the listing itself intact -- an empty page would also answer 200,
    // and would be the wrong answer.
    it('ignores an unrecognized sort key or search field instead of failing the request', async () =>
    {
        const booted = await bootTestApp();
        const adminCookie = await makeAdmin(booted, 'root@example.com', PASSWORD);

        const res = await booted.app.request(
            `${ ORIGIN }/api/admin/users?sortBy=quotaLimit;drop&searchField=role`,
            { headers: { cookie: adminCookie } }
        );
        const page = await res.json();

        expect(res.status).toBe(200);
        expect(page.users.map((user : { email : string }) => user.email)).toEqual([ 'root@example.com' ]);
        expect(page.total).toBe(1);
    });
});

//----------------------------------------------------------------------------------------------------------------------
