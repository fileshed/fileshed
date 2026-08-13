//----------------------------------------------------------------------------------------------------------------------
// E2E — Revoking every credential over real sockets
//
// One POST ends every session the caller holds and revokes every access token they hold, against a real server and a
// real database. Both halves are asserted on the live wire: the session cookie cache is off, so a browser-shaped
// client whose session row is gone is refused on its very next request rather than for some window afterwards.
//
// The assertion that carries the most weight is the one taken after that refusal -- that the dead cookie cannot mint
// an access token. A token minted with a revoked cookie would outlive the revocation forever, turning a moment of
// residual access into permanent access, which is the one outcome this button exists to prevent.
//
// The bystander is the point of the file otherwise. An account that never asked for any of this must come out
// untouched -- sessions, tokens, and all -- or the button is a way to sign other people out.
//----------------------------------------------------------------------------------------------------------------------

import { sql } from 'kysely';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { CreateAccessTokenResponse } from '@fileshed/core';

// Support
import { ApiClient, type ServerHandle, spawnServer, withDb } from './support.ts';

//----------------------------------------------------------------------------------------------------------------------

const PASSWORD = 'correct-horse-battery';

let server : ServerHandle;
let caller : ApiClient;
let bystander : ApiClient;

//----------------------------------------------------------------------------------------------------------------------

async function signUpAccount(email : string) : Promise<ApiClient>
{
    const client = new ApiClient(server.baseURL);
    const res = await client.signUp(email, PASSWORD);
    expect(res.status).toBe(200);

    return client;
}

async function mintToken(client : ApiClient, name : string) : Promise<string>
{
    const res = await client.post('/api/me/access-tokens', { name, scopes: [ 'account:read' ] });
    expect(res.status).toBe(200);

    return (await res.json() as CreateAccessTokenResponse).token;
}

// A cookie-less fetch, the way a script actually presents a token.
async function profileStatusWith(token : string) : Promise<number>
{
    const res = await fetch(`${ server.baseURL }/api/me`, { headers: { authorization: `Bearer ${ token }` } });
    await res.arrayBuffer();

    return res.status;
}

async function idOf(email : string) : Promise<string>
{
    return withDb(server, async (db) =>
    {
        const row = await db.selectFrom('user').select('id')
            .where('email', '=', email)
            .executeTakeFirstOrThrow();

        return row.id;
    });
}

async function countOf(table : 'session' | 'apikey', column : string, userID : string) : Promise<number>
{
    return withDb(server, async (db) =>
    {
        const result = await sql`select count(*) as total from ${ sql.ref(table) }
            where ${ sql.ref(column) } = ${ userID }`.execute(db);
        const row = result.rows[0] as { total : string | number };

        return Number(row.total);
    });
}

//----------------------------------------------------------------------------------------------------------------------

beforeAll(async () =>
{
    server = await spawnServer();
    caller = await signUpAccount('panic@example.com');
    bystander = await signUpAccount('bystander@example.com');
});

afterAll(async () =>
{
    await server.stop();
});

//----------------------------------------------------------------------------------------------------------------------

describe('POST /api/me/revoke-credentials', () =>
{
    it('kills the caller\'s sessions and tokens while the bystander keeps every one of theirs', async () =>
    {
        const callerID = await idOf('panic@example.com');
        const bystanderID = await idOf('bystander@example.com');

        const callerToken = await mintToken(caller, 'backup script');
        const bystanderToken = await mintToken(bystander, 'their script');

        // A second device for each: a panic button that only ended the session it was clicked from would be useless.
        await new ApiClient(server.baseURL).signIn('panic@example.com', PASSWORD);
        await new ApiClient(server.baseURL).signIn('bystander@example.com', PASSWORD);

        expect(await profileStatusWith(callerToken)).toBe(200);
        expect(await profileStatusWith(bystanderToken)).toBe(200);
        expect(await countOf('session', 'userId', callerID)).toBeGreaterThanOrEqual(2);

        const res = await caller.post('/api/me/revoke-credentials');
        expect(res.status).toBe(204);

        expect(await profileStatusWith(callerToken)).toBe(401);
        expect(await countOf('session', 'userId', callerID)).toBe(0);
        expect(await countOf('apikey', 'referenceId', callerID)).toBe(0);

        // The caller's own client still holds the cookie jar it signed in with. That cookie is refused now, not in a
        // minute -- and it cannot mint a token, which is what a minute of residual access would have bought.
        expect((await caller.get('/api/me')).status).toBe(401);

        const afterwards = await caller.post('/api/me/access-tokens', { name: 'after', scopes: [ 'account:read' ] });
        expect(afterwards.status).toBe(401);
        expect(await countOf('apikey', 'referenceId', callerID)).toBe(0);

        expect(await profileStatusWith(bystanderToken)).toBe(200);
        expect(await countOf('session', 'userId', bystanderID)).toBeGreaterThanOrEqual(2);
        expect(await countOf('apikey', 'referenceId', bystanderID)).toBe(1);
    });

    it('refuses an access token trying to spend itself on its owner\'s credentials', async () =>
    {
        const token = await mintToken(bystander, 'stolen token');

        const res = await fetch(`${ server.baseURL }/api/me/revoke-credentials`, {
            method: 'POST',
            headers: { authorization: `Bearer ${ token }` },
        });
        await res.arrayBuffer();

        expect(res.status).toBe(401);
        expect(await profileStatusWith(token)).toBe(200);
    });

    it('refuses a caller with no credential at all', async () =>
    {
        const res = await fetch(`${ server.baseURL }/api/me/revoke-credentials`, { method: 'POST' });
        await res.arrayBuffer();

        expect(res.status).toBe(401);
    });
});

//----------------------------------------------------------------------------------------------------------------------
