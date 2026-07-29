//----------------------------------------------------------------------------------------------------------------------
// Auth Mail Flows — password reset and required verification, end to end over HTTP
//
// The contract: requesting a password reset hands the mail hook a link whose token completes the reset -- the old
// password stops working, the new one signs in, and every existing session dies with the reset (the credential may
// have been compromised). The request itself answers 200 whether the address exists or not, so the endpoint is not
// an account oracle. With requireEmailVerification frozen in at boot, an unverified account cannot sign in and
// each attempt re-sends the verification link.
//----------------------------------------------------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';
import type { Hono } from 'hono';
import { sql } from 'kysely';

// Resource Access
import type { AuthMailHooks } from '@server/resource-access/auth.ts';

// Support
import { type BootedApp, ORIGIN, bootTestApp, signIn, signUp } from './support.ts';

//----------------------------------------------------------------------------------------------------------------------

const PASSWORD = 'correct-horse-battery';

// The mail seam as a recorder: better-auth's callbacks land links here instead of an SMTP server.
class RecordingHooks implements AuthMailHooks
{
    readonly resets : { to : string; url : string }[] = [];
    readonly verifications : { to : string; url : string }[] = [];

    sendPasswordReset(to : string, url : string) : void { this.resets.push({ to, url }); }
    sendVerification(to : string, url : string) : void { this.verifications.push({ to, url }); }
}

function post(app : Hono, path : string, body : unknown) : Promise<Response>
{
    return app.request(`${ ORIGIN }${ path }`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'origin': ORIGIN },
        body: JSON.stringify(body),
    });
}

async function sessionCountOf(booted : BootedApp, email : string) : Promise<number>
{
    const result = await sql`
        select count(*) as total from session
        where "userId" = (select id from "user" where email = ${ email })
    `.execute(booted.handle.db);
    const row = result.rows[0] as { total : string | number };

    return Number(row.total);
}

// The reset link better-auth builds carries the token in its path/query; the reset endpoint wants the raw token.
function tokenFrom(url : string) : string
{
    const match = /token=([^&]+)/.exec(url) ?? /reset-password\/([^?]+)/.exec(url);
    if(!match?.[1]) { throw new Error(`no token in reset url: ${ url }`); }

    return decodeURIComponent(match[1]);
}

//----------------------------------------------------------------------------------------------------------------------

describe('password reset over email', () =>
{
    it('resets end to end: link sent, new password in, old password and old sessions out', async () =>
    {
        const hooks = new RecordingHooks();
        const booted = await bootTestApp({}, { mail: hooks });
        await signUp(booted.app, 'member@example.com', PASSWORD);
        await signIn(booted.app, 'member@example.com', PASSWORD);
        expect(await sessionCountOf(booted, 'member@example.com')).toBeGreaterThan(0);

        const requested = await post(booted.app, '/api/auth/request-password-reset', {
            email: 'member@example.com',
            redirectTo: `${ ORIGIN }/reset-password`,
        });
        expect(requested.status).toBe(200);
        expect(hooks.resets[0]?.to).toBe('member@example.com');

        const reset = await post(booted.app, '/api/auth/reset-password', {
            newPassword: 'a-brand-new-password',
            token: tokenFrom(hooks.resets[0]?.url ?? ''),
        });
        expect(reset.status).toBe(200);

        expect((await signIn(booted.app, 'member@example.com', PASSWORD)).status).not.toBe(200);
        expect((await signIn(booted.app, 'member@example.com', 'a-brand-new-password')).status).toBe(200);
    });

    it('revokes the sessions that existed before the reset', async () =>
    {
        const hooks = new RecordingHooks();
        const booted = await bootTestApp({}, { mail: hooks });
        await signUp(booted.app, 'member@example.com', PASSWORD);
        await signIn(booted.app, 'member@example.com', PASSWORD);
        const before = await sessionCountOf(booted, 'member@example.com');
        expect(before).toBeGreaterThan(0);

        await post(booted.app, '/api/auth/request-password-reset', { email: 'member@example.com' });
        await post(booted.app, '/api/auth/reset-password', {
            newPassword: 'a-brand-new-password',
            token: tokenFrom(hooks.resets[0]?.url ?? ''),
        });

        expect(await sessionCountOf(booted, 'member@example.com')).toBe(0);
    });

    it('answers an unknown address exactly like a known one, sending nothing', async () =>
    {
        const hooks = new RecordingHooks();
        const booted = await bootTestApp({}, { mail: hooks });

        const res = await post(booted.app, '/api/auth/request-password-reset', { email: 'nobody@example.com' });

        expect(res.status).toBe(200);
        expect(hooks.resets).toHaveLength(0);
    });
});

//----------------------------------------------------------------------------------------------------------------------

describe('required email verification (frozen at boot)', () =>
{
    it('refuses an unverified sign-in and re-sends the verification link on each attempt', async () =>
    {
        const hooks = new RecordingHooks();
        const booted = await bootTestApp({}, { mail: hooks, requireEmailVerification: true });

        await signUp(booted.app, 'member@example.com', PASSWORD);

        const refused = await signIn(booted.app, 'member@example.com', PASSWORD);
        expect(refused.status).toBe(403);
        expect(hooks.verifications.length).toBeGreaterThan(0);
        expect(hooks.verifications[0]?.to).toBe('member@example.com');
    });

    it('admits the sign-in once the email is verified', async () =>
    {
        const hooks = new RecordingHooks();
        const booted = await bootTestApp({}, { mail: hooks, requireEmailVerification: true });
        await signUp(booted.app, 'member@example.com', PASSWORD);
        await signIn(booted.app, 'member@example.com', PASSWORD);

        // Verification lands as a browser GET on the link from the email.
        const url = hooks.verifications[0]?.url ?? '';
        const verified = await booted.app.request(url, { redirect: 'manual' });
        expect([ 200, 302 ]).toContain(verified.status);

        expect((await signIn(booted.app, 'member@example.com', PASSWORD)).status).toBe(200);
    });
});

//----------------------------------------------------------------------------------------------------------------------
