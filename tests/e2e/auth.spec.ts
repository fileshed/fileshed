//----------------------------------------------------------------------------------------------------------------------
// E2E — Auth, sessions, and the admin gate
//
// Real sign-up/sign-in over a real socket with real Set-Cookie/Cookie round-trips, then the admin surface end to end:
// the /api/admin/users authn/authz ladder and the gate that refuses better-auth's own admin endpoints externally even
// to a valid admin (app.ts). The admin account is planted by first-run bootstrap through the
// FILESHED_SETUP_TOKEN-gated first-run setup, so a successful admin session also proves the wizard's backend.
//----------------------------------------------------------------------------------------------------------------------

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// Support
import { ApiClient, type ServerHandle, spawnServer } from './support.ts';

//----------------------------------------------------------------------------------------------------------------------

const ADMIN_EMAIL = 'admin@fileshed.test';
const ADMIN_PASSWORD = 'admin-password-e2e';
const PASSWORD = 'correct-horse-battery';

let server : ServerHandle;

beforeAll(async () =>
{
    server = await spawnServer({ env: { FILESHED_SETUP_TOKEN: 'e2e-setup-token-1234' } });

    // First-run setup over the wire: the operator token gates admin creation, the password rides only this POST.
    const setup = await new ApiClient(server.baseURL).post('/api/setup', {
        token: 'e2e-setup-token-1234',
        name: 'Administrator',
        email: ADMIN_EMAIL,
        password: ADMIN_PASSWORD,
    });
    if(setup.status !== 200) { throw new Error('setup: expected first-run setup to succeed'); }
});

afterAll(async () =>
{
    await server?.stop();
});

//----------------------------------------------------------------------------------------------------------------------
// Sessions over real cookies
//----------------------------------------------------------------------------------------------------------------------

describe('sign-up / sign-in / session', () =>
{
    it('signs a new account in and serves its profile from the session cookie', async () =>
    {
        const client = new ApiClient(server.baseURL);

        const signUp = await client.signUp('member-a@example.com', PASSWORD);
        expect(signUp.status).toBe(200);

        const me = await client.get('/api/me');
        const profile = await me.json();

        expect(me.status).toBe(200);
        expect(profile).toMatchObject({
            email: 'member-a@example.com',
            role: 'user',
            quota: { used: 0, limit: null },
        });
    });

    it('rejects a request with no session cookie', async () =>
    {
        const anonymous = new ApiClient(server.baseURL);

        const me = await anonymous.get('/api/me');

        expect(me.status).toBe(401);
        expect(await me.json()).toHaveProperty('error');
    });

    it('restores a session on a fresh client via sign-in', async () =>
    {
        const first = new ApiClient(server.baseURL);
        await first.signUp('member-b@example.com', PASSWORD);

        // A second client with an empty jar must sign in for itself -- proving the session rides the cookie, not
        // in-process state.
        const second = new ApiClient(server.baseURL);
        const signIn = await second.signIn('member-b@example.com', PASSWORD);
        expect(signIn.status).toBe(200);

        const me = await second.get('/api/me');
        const profile = await me.json();

        expect(me.status).toBe(200);
        expect(profile.email).toBe('member-b@example.com');
    });

    it('saves a root-label preference and serves it back, persisting across a fresh session', async () =>
    {
        const client = new ApiClient(server.baseURL);
        await client.signUp('member-prefs@example.com', PASSWORD);

        const patched = await client.patch('/api/me/preferences', { rootLabel: 'My Vault' });
        expect(patched.status).toBe(200);
        expect((await patched.json()).preferences.rootLabel).toBe('My Vault');

        // A fresh client signs in with an empty jar: the preference comes from the row, not a session snapshot, so a
        // new session sees it immediately -- the same read a page reload makes.
        const reader = new ApiClient(server.baseURL);
        await reader.signIn('member-prefs@example.com', PASSWORD);
        const me = await reader.get('/api/me');

        expect(me.status).toBe(200);
        expect((await me.json()).preferences.rootLabel).toBe('My Vault');
    });
});

//----------------------------------------------------------------------------------------------------------------------
// First-run admin bootstrap
//----------------------------------------------------------------------------------------------------------------------

describe('bootstrapped admin', () =>
{
    it('signs in the env-provisioned admin with an admin role in its session', async () =>
    {
        const admin = new ApiClient(server.baseURL);

        const signIn = await admin.signIn(ADMIN_EMAIL, ADMIN_PASSWORD);
        expect(signIn.status).toBe(200);

        const me = await admin.get('/api/me');
        const profile = await me.json();

        expect(me.status).toBe(200);
        expect(profile.email).toBe(ADMIN_EMAIL);
        expect(profile.role).toBe('admin');
    });
});

//----------------------------------------------------------------------------------------------------------------------
// Admin surface: the authn/authz ladder and the external gate (app.ts)
//----------------------------------------------------------------------------------------------------------------------

describe('GET /api/admin/users', () =>
{
    it('rejects an anonymous request with 401', async () =>
    {
        const anonymous = new ApiClient(server.baseURL);

        const res = await anonymous.get('/api/admin/users');

        expect(res.status).toBe(401);
        expect(await res.json()).toHaveProperty('error');
    });

    it('rejects a signed-in non-admin with 403', async () =>
    {
        const member = new ApiClient(server.baseURL);
        await member.signUp('member-c@example.com', PASSWORD);

        const res = await member.get('/api/admin/users');

        expect(res.status).toBe(403);
        expect(await res.json()).toHaveProperty('error');
    });

    it('returns the user list to the admin with 200', async () =>
    {
        const admin = new ApiClient(server.baseURL);
        await admin.signIn(ADMIN_EMAIL, ADMIN_PASSWORD);

        const res = await admin.get('/api/admin/users');
        const body = await res.json();

        expect(res.status).toBe(200);
        const emails = body.users.map((user : { email : string }) => user.email);
        expect(emails).toContain(ADMIN_EMAIL);
    });
});

describe('better-auth admin surface gate', () =>
{
    it('404s the internal admin endpoints externally even with a valid admin cookie', async () =>
    {
        const admin = new ApiClient(server.baseURL);
        await admin.signIn(ADMIN_EMAIL, ADMIN_PASSWORD);

        // better-auth's own admin plugin would answer /api/auth/admin/list-users; the app.ts gate refuses that surface
        // before the auth mount ever sees it, so the only reachable admin surface is FileShed's own (/api/admin/*).
        const res = await admin.post('/api/auth/admin/list-users', { limit: 10 });

        expect(res.status).toBe(404);
        expect(await res.json()).toHaveProperty('error');
    });
});

//----------------------------------------------------------------------------------------------------------------------
