//----------------------------------------------------------------------------------------------------------------------
// E2E — Admin user management
//
// The Users tab's backend over real sockets and real state: the listing charges each account the bytes it actually
// uploaded; a ban refuses the target's next sign-in, empties their session rows, and an unban lets them back in; an
// admin-set password is the no-email reset; revoke-sessions signs a user out everywhere at the row level; and a
// role change is a real promotion -- the promoted account can reach the admin surface, and loses it again on
// demotion. Each concern gets its own account so the flows cannot contaminate each other.
//----------------------------------------------------------------------------------------------------------------------

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'kysely';

// Support
import {
    ApiClient,
    type ServerHandle,
    sha256Of,
    smallFixture,
    spawnServer,
    withDb,
} from './support.ts';

//----------------------------------------------------------------------------------------------------------------------

const ADMIN_EMAIL = 'admin@fileshed.test';
const ADMIN_PASSWORD = 'admin-password-e2e';
const PASSWORD = 'correct-horse-battery';

let server : ServerHandle;
let admin : ApiClient;

beforeAll(async () =>
{
    server = await spawnServer({ env: { FILESHED_SETUP_TOKEN: 'e2e-setup-token-1234' } });

    const setup = await new ApiClient(server.baseURL).post('/api/setup', {
        token: 'e2e-setup-token-1234',
        name: 'Administrator',
        email: ADMIN_EMAIL,
        password: ADMIN_PASSWORD,
    });
    if(setup.status !== 200) { throw new Error('setup: expected first-run setup to succeed'); }

    admin = new ApiClient(server.baseURL);
    const signIn = await admin.signIn(ADMIN_EMAIL, ADMIN_PASSWORD);
    if(signIn.status !== 200) { throw new Error('setup: expected the admin sign-in to succeed'); }
});

afterAll(async () =>
{
    await server?.stop();
});

//----------------------------------------------------------------------------------------------------------------------

async function signUpMember(email : string) : Promise<ApiClient>
{
    const client = new ApiClient(server.baseURL);
    const res = await client.signUp(email, PASSWORD);
    if(res.status !== 200) { throw new Error(`setup: expected ${ email } to sign up`); }

    return client;
}

interface WireUser { id : string; email : string; usedBytes : number; banned : boolean }

async function rowFor(email : string) : Promise<WireUser>
{
    const res = await admin.get(`/api/admin/users?search=${ encodeURIComponent(email) }`);
    const page = await res.json() as { users : WireUser[] };
    const row = page.users.find((user) => user.email === email);
    if(row === undefined) { throw new Error(`expected the listing to find ${ email }`); }

    return row;
}

async function sessionCountOf(userID : string) : Promise<number>
{
    return withDb(server, async (db) =>
    {
        const result = await sql`select count(*) as total from session where "userId" = ${ userID }`.execute(db);
        const row = result.rows[0] as { total : string | number };

        return Number(row.total);
    });
}

//----------------------------------------------------------------------------------------------------------------------

describe('the listing and its usage column', () =>
{
    it('charges an account the bytes it actually uploaded', async () =>
    {
        const member = await signUpMember('usage@example.com');
        const data = smallFixture('admin-usage-fixture');

        const claim = await (await member.post('/api/blobs/claim', { sha256: sha256Of(data), size: data.length }))
            .json() as { upload : boolean; ticket : string };
        expect(claim.upload).toBe(true);

        const query = new URLSearchParams({ name: 'usage.bin', mimeType: 'application/octet-stream' });
        const put = await member.put(`/api/uploads/${ claim.ticket }?${ query.toString() }`, data);
        expect(put.status).toBe(200);

        const before = await rowFor(ADMIN_EMAIL);
        expect(before.usedBytes).toBe(0);
        expect((await rowFor('usage@example.com')).usedBytes).toBe(data.length);
    });
});

//----------------------------------------------------------------------------------------------------------------------

describe('ban and unban', () =>
{
    it('a ban refuses the next sign-in and empties the session rows; an unban restores entry', async () =>
    {
        await signUpMember('banned@example.com');
        const target = await rowFor('banned@example.com');

        const ban = await admin.post(
            `/api/admin/users/${ target.id }/ban`,
            { reason: 'Spamming', expiresInDays: 7 }
        );
        const banned = await ban.json() as { banned : boolean; banReason : string; banExpires : string };

        expect(ban.status).toBe(200);
        expect(banned.banned).toBe(true);
        expect(banned.banReason).toBe('Spamming');
        expect(typeof banned.banExpires).toBe('string');
        expect(await sessionCountOf(target.id)).toBe(0);

        const refused = await new ApiClient(server.baseURL).signIn('banned@example.com', PASSWORD);
        expect(refused.status).toBe(403);

        const unban = await admin.post(`/api/admin/users/${ target.id }/unban`, {});
        expect(unban.status).toBe(200);

        const restored = await new ApiClient(server.baseURL).signIn('banned@example.com', PASSWORD);
        expect(restored.status).toBe(200);
    });
});

//----------------------------------------------------------------------------------------------------------------------

describe('admin-set password', () =>
{
    it('the old password is refused, the new one signs in', async () =>
    {
        await signUpMember('reset-me@example.com');
        const target = await rowFor('reset-me@example.com');

        const res = await admin.post(
            `/api/admin/users/${ target.id }/password`,
            { password: 'a-brand-new-password' }
        );
        expect(res.status).toBe(204);

        expect((await new ApiClient(server.baseURL).signIn('reset-me@example.com', PASSWORD)).status).not.toBe(200);
        expect((await new ApiClient(server.baseURL).signIn('reset-me@example.com', 'a-brand-new-password')).status)
            .toBe(200);
    });
});

//----------------------------------------------------------------------------------------------------------------------

describe('revoke sessions', () =>
{
    it('empties every session row the target holds', async () =>
    {
        await signUpMember('everywhere@example.com');
        await new ApiClient(server.baseURL).signIn('everywhere@example.com', PASSWORD);
        const target = await rowFor('everywhere@example.com');
        expect(await sessionCountOf(target.id)).toBeGreaterThanOrEqual(2);

        const res = await admin.post(`/api/admin/users/${ target.id }/revoke-sessions`, {});

        expect(res.status).toBe(204);
        expect(await sessionCountOf(target.id)).toBe(0);
    });
});

//----------------------------------------------------------------------------------------------------------------------

describe('role changes', () =>
{
    it('a promotion opens the admin surface to the target, and a demotion closes it again', async () =>
    {
        const member = await signUpMember('climber@example.com');
        const target = await rowFor('climber@example.com');

        expect((await member.get('/api/admin/users')).status).toBe(403);

        const promote = await admin.post(`/api/admin/users/${ target.id }/role`, { role: 'admin' });
        expect(promote.status).toBe(200);

        // A fresh sign-in mints a session that reflects the new role; the old cookie's cached role would lag it.
        const promoted = new ApiClient(server.baseURL);
        await promoted.signIn('climber@example.com', PASSWORD);
        expect((await promoted.get('/api/admin/users')).status).toBe(200);

        const demote = await admin.post(`/api/admin/users/${ target.id }/role`, { role: 'user' });
        expect(demote.status).toBe(200);

        const demoted = new ApiClient(server.baseURL);
        await demoted.signIn('climber@example.com', PASSWORD);
        expect((await demoted.get('/api/admin/users')).status).toBe(403);
    });

    it('refuses the admin demoting themselves', async () =>
    {
        const adminRow = await rowFor(ADMIN_EMAIL);

        const res = await admin.post(`/api/admin/users/${ adminRow.id }/role`, { role: 'user' });

        expect(res.status).toBe(400);
    });
});

//----------------------------------------------------------------------------------------------------------------------
