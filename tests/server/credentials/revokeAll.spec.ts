//----------------------------------------------------------------------------------------------------------------------
// Revoke Every Credential — the account's own panic button
//
// The contract, against the real stack: one call ends every session the caller holds and revokes every access token
// they hold, so a credential that worked a moment before the call is refused after it. The caller's own session is
// not spared -- signing themselves out is the point. It is scoped to the caller and to nobody else, which is what
// separates a panic button from a way to sign other people out. It is session-only: a stolen token cannot spend
// itself locking its owner out of the account.
//
// The session cookie cache is off, so every request here is answered from the session row: a refusal is the row being
// gone, never a cache that happened to miss. That is what lets the last test below assert the thing the button is
// really for -- that a revoked cookie cannot mint a credential that would outlive the revocation.
//----------------------------------------------------------------------------------------------------------------------

import { sql } from 'kysely';

import { beforeEach, describe, expect, it } from 'vitest';

import type { CreateAccessTokenResponse } from '@fileshed/core';

// Support
import {
    type BootedApp,
    ORIGIN,
    bootFullApp,
    cookieFrom,
    cookieJarFrom,
    signIn,
    signUp,
} from '../auth/support.ts';

//----------------------------------------------------------------------------------------------------------------------

const PASSWORD = 'correct-horse-battery';

let booted : BootedApp;

//----------------------------------------------------------------------------------------------------------------------
// Helpers
//----------------------------------------------------------------------------------------------------------------------

interface Account
{
    id : string;
    cookie : string;
}

async function makeAccount(email : string) : Promise<Account>
{
    await signUp(booted.app, email, PASSWORD);
    const cookie = cookieFrom(await signIn(booted.app, email, PASSWORD));

    const row = await booted.handle.db
        .selectFrom('user')
        .select('id')
        .where('email', '=', email)
        .executeTakeFirstOrThrow();

    return { id: row.id, cookie };
}

async function anotherSessionFor(email : string) : Promise<string>
{
    return cookieFrom(await signIn(booted.app, email, PASSWORD));
}

// A token scoped to read the profile, so GET /api/me answers it -- the same surface the session cookies are proved
// against, which keeps "the token is dead" and "the session is dead" the same assertion on the same route.
async function mintToken(session : string, name : string) : Promise<string>
{
    const res = await booted.app.request(`${ ORIGIN }/api/me/access-tokens`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'cookie': session, 'origin': ORIGIN },
        body: JSON.stringify({ name, scopes: [ 'account:read' ] }),
    });

    expect(res.status).toBe(200);

    return (await res.json() as CreateAccessTokenResponse).token;
}

// The media player's own short-lived key. Nothing lists it anywhere, so a count of the rows is the only place its
// surviving the panic would ever show.
async function mintPlaybackToken(session : string) : Promise<void>
{
    const res = await booted.app.request(`${ ORIGIN }/api/me/playback-token`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'cookie': session, 'origin': ORIGIN },
        body: JSON.stringify({}),
    });

    expect(res.status).toBe(200);
}

function withCookie(cookie : string) : Promise<Response>
{
    return booted.app.request(`${ ORIGIN }/api/me`, { headers: { cookie } });
}

function withToken(token : string) : Promise<Response>
{
    return booted.app.request(`${ ORIGIN }/api/me`, { headers: { authorization: `Bearer ${ token }` } });
}

function panic(cookie : string) : Promise<Response>
{
    return booted.app.request(`${ ORIGIN }/api/me/revoke-credentials`, {
        method: 'POST',
        headers: { cookie, origin: ORIGIN },
    });
}

async function tokenCountOf(userID : string) : Promise<number>
{
    const result = await sql`select count(*) as total from apikey where "referenceId" = ${ userID }`
        .execute(booted.handle.db);
    const row = result.rows[0] as { total : string | number };

    return Number(row.total);
}

//----------------------------------------------------------------------------------------------------------------------

beforeEach(async () =>
{
    booted = await bootFullApp();
});

//----------------------------------------------------------------------------------------------------------------------

describe('POST /api/me/revoke-credentials', () =>
{
    it('refuses a session that was live before the call', async () =>
    {
        const caller = await makeAccount('panic@example.com');
        const laptop = await anotherSessionFor('panic@example.com');

        expect((await withCookie(laptop)).status).toBe(200);

        expect((await panic(caller.cookie)).status).toBe(204);

        expect((await withCookie(laptop)).status).toBe(401);
    });

    it('refuses an access token that was live before the call', async () =>
    {
        const caller = await makeAccount('panic@example.com');
        const token = await mintToken(caller.cookie, 'backup script');

        expect((await withToken(token)).status).toBe(200);

        expect((await panic(caller.cookie)).status).toBe(204);

        expect((await withToken(token)).status).toBe(401);
    });

    it('ends the calling session too, so the next request from it is refused', async () =>
    {
        const caller = await makeAccount('panic@example.com');

        expect((await withCookie(caller.cookie)).status).toBe(200);

        expect((await panic(caller.cookie)).status).toBe(204);

        expect((await withCookie(caller.cookie)).status).toBe(401);
    });

    it('leaves another account\'s sessions and tokens working', async () =>
    {
        const caller = await makeAccount('panic@example.com');
        const bystander = await makeAccount('bystander@example.com');
        const bystanderToken = await mintToken(bystander.cookie, 'their script');
        const bystanderPhone = await anotherSessionFor('bystander@example.com');

        expect((await panic(caller.cookie)).status).toBe(204);

        expect((await withCookie(bystander.cookie)).status).toBe(200);
        expect((await withCookie(bystanderPhone)).status).toBe(200);
        expect((await withToken(bystanderToken)).status).toBe(200);
        expect(await tokenCountOf(bystander.id)).toBe(1);
    });

    it('revokes every token the caller holds, not only the newest', async () =>
    {
        const caller = await makeAccount('panic@example.com');
        const first = await mintToken(caller.cookie, 'backup script');
        const second = await mintToken(caller.cookie, 'sync tool');

        expect((await panic(caller.cookie)).status).toBe(204);

        expect((await withToken(first)).status).toBe(401);
        expect((await withToken(second)).status).toBe(401);
        expect(await tokenCountOf(caller.id)).toBe(0);
    });

    // The delete is one config-blind statement today, so this costs nothing -- but it is the only test that would
    // notice a move to the plugin's per-config delete leaving playback keys behind. A playback key downloads files,
    // so one survivor leaves the whole library readable by whoever the panic was pressed over.
    it('revokes the playback keys too, not only the tokens the account can see', async () =>
    {
        const caller = await makeAccount('panic@example.com');
        await mintToken(caller.cookie, 'backup script');
        await mintPlaybackToken(caller.cookie);

        expect(await tokenCountOf(caller.id)).toBe(2);

        expect((await panic(caller.cookie)).status).toBe(204);
        expect(await tokenCountOf(caller.id)).toBe(0);
    });

    // The api-key plugin can be configured to mint a session from a key header. It is not, and this is where that
    // stays true: were it on, a stolen token would carry a session and could spend it on this very endpoint.
    it('will not let an access token become a session through the key header', async () =>
    {
        const caller = await makeAccount('panic@example.com');
        const token = await mintToken(caller.cookie, 'stolen token');

        const res = await booted.app.request(`${ ORIGIN }/api/me/revoke-credentials`, {
            method: 'POST',
            headers: { 'x-api-key': token, 'origin': ORIGIN },
        });

        expect(res.status).toBe(401);
        expect(await tokenCountOf(caller.id)).toBe(1);
    });

    it('refuses an access token trying to revoke its own owner\'s credentials', async () =>
    {
        const caller = await makeAccount('panic@example.com');
        const token = await mintToken(caller.cookie, 'stolen token');

        const res = await booted.app.request(`${ ORIGIN }/api/me/revoke-credentials`, {
            method: 'POST',
            headers: { authorization: `Bearer ${ token }`, origin: ORIGIN },
        });

        expect(res.status).toBe(401);
        expect((await withCookie(caller.cookie)).status).toBe(200);
        expect((await withToken(token)).status).toBe(200);
    });

    // Every cookie a browser would carry, on purpose: this is the one test here that must notice a cached session
    // snapshot, and every other request in the file sends the token alone and so is blind to one. Sixty seconds of a
    // cookie that still answers would be survivable by itself. Sixty seconds in which it can mint a token is not --
    // the token outlives the revocation forever, and nothing marks the account for a later request to re-check.
    it('leaves the revoked cookie unable to mint a credential that would outlive the revocation', async () =>
    {
        await signUp(booted.app, 'panic@example.com', PASSWORD);
        const jar = cookieJarFrom(await signIn(booted.app, 'panic@example.com', PASSWORD));

        const row = await booted.handle.db
            .selectFrom('user')
            .select('id')
            .where('email', '=', 'panic@example.com')
            .executeTakeFirstOrThrow();

        expect((await panic(jar)).status).toBe(204);

        const minted = await booted.app.request(`${ ORIGIN }/api/me/access-tokens`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'cookie': jar, 'origin': ORIGIN },
            body: JSON.stringify({ name: 'after the panic', scopes: [ 'account:read' ] }),
        });

        expect(minted.status).toBe(401);
        expect(await tokenCountOf(row.id)).toBe(0);
    });

    it('refuses a caller with no session at all', async () =>
    {
        const res = await booted.app.request(`${ ORIGIN }/api/me/revoke-credentials`, {
            method: 'POST',
            headers: { origin: ORIGIN },
        });

        expect(res.status).toBe(401);
    });
});

//----------------------------------------------------------------------------------------------------------------------
