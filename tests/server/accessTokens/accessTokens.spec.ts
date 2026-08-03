//----------------------------------------------------------------------------------------------------------------------
// Access Tokens — minting, the credential plane, and scope containment
//
// The contract under test, end to end against the real stack: PATs are minted only by sessions and carry exactly the
// chosen scopes frozen at creation; a token authenticates as its owner on routes that opted in, via bearer header or
// ?token=, with exact-containment scope checks; session-only surfaces reject tokens entirely; playback keys are a
// separate config that never appears in the managed list; and a token dies with revocation, with its owner's ban
// (the database hook), or with its owner's disappearance (the seam's backstop user check).
//----------------------------------------------------------------------------------------------------------------------

import { randomBytes } from 'node:crypto';
import { sql } from 'kysely';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
    ACCESS_TOKEN_PREFIX,
    type AccessTokenScope,
    type CreateAccessTokenResponse,
    MS_PER_HOUR,
    PLAYBACK_TOKEN_PREFIX,
    type PlaybackTokenResponse,
} from '@fileshed/core';

// Support
import { makeAdmin } from '../auth/support.ts';
import {
    type BootedServeApp,
    ORIGIN,
    type TestUser,
    type UploadedFile,
    bodyBytes,
    bootServeApp,
    makeUser,
    uploadFile,
} from '../publicLinks/support.ts';

//----------------------------------------------------------------------------------------------------------------------

let booted : BootedServeApp;
let owner : TestUser;
let fixture : Buffer;
let uploaded : UploadedFile;

beforeEach(async () =>
{
    booted = await bootServeApp();
    owner = await makeUser(booted, 'owner@example.com');
    fixture = randomBytes(300);
    uploaded = await uploadFile(booted, owner, fixture, { name: 'track.mp3', mimeType: 'audio/mpeg' });
});

afterEach(async () =>
{
    await booted.cleanup();
});

//----------------------------------------------------------------------------------------------------------------------
// Helpers
//----------------------------------------------------------------------------------------------------------------------

async function mintPat(
    user : TestUser,
    scopes : AccessTokenScope[],
    name = 'spec token'
) : Promise<CreateAccessTokenResponse>
{
    const res = await booted.app.request(`${ ORIGIN }/api/me/access-tokens`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'cookie': user.cookie, 'origin': ORIGIN },
        body: JSON.stringify({ name, scopes }),
    });

    expect(res.status).toBe(200);
    return await res.json() as CreateAccessTokenResponse;
}

async function mintPlayback(user : TestUser, previousID : string | null = null) : Promise<PlaybackTokenResponse>
{
    const res = await booted.app.request(`${ ORIGIN }/api/me/playback-token`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'cookie': user.cookie, 'origin': ORIGIN },
        body: JSON.stringify({ previousID }),
    });

    expect(res.status).toBe(200);
    return await res.json() as PlaybackTokenResponse;
}

function bearerRequest(path : string, token : string, init : RequestInit = {}) : Promise<Response>
{
    return booted.app.request(`${ ORIGIN }${ path }`, {
        ...init,
        headers: { ...init.headers as Record<string, string>, authorization: `Bearer ${ token }` },
    });
}

//----------------------------------------------------------------------------------------------------------------------

describe('PAT minting and management', () =>
{
    it('mints a prefixed one-time token whose record carries the chosen scopes and no value', async () =>
    {
        const minted = await mintPat(owner, [ 'files:read' ], 'backup script');

        expect(minted.token.startsWith(ACCESS_TOKEN_PREFIX)).toBe(true);
        expect(minted.accessToken.name).toBe('backup script');
        expect(minted.accessToken.scopes).toEqual(expect.arrayContaining([ 'files:download', 'files:read' ]));
        expect(minted.accessToken.expiresAt).toBeNull();
        expect(JSON.stringify(minted.accessToken)).not.toContain(minted.token);

        const listRes = await booted.app.request(`${ ORIGIN }/api/me/access-tokens`, {
            headers: { cookie: owner.cookie },
        });
        const list = await listRes.json() as { accessTokens : { id : string; start : string | null }[] };

        expect(list.accessTokens).toHaveLength(1);
        expect(list.accessTokens[0]?.id).toBe(minted.accessToken.id);
        expect(list.accessTokens[0]?.start?.startsWith(ACCESS_TOKEN_PREFIX)).toBe(true);
    });

    it('stamps a user-chosen expiry in whole days', async () =>
    {
        const res = await booted.app.request(`${ ORIGIN }/api/me/access-tokens`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'cookie': owner.cookie, 'origin': ORIGIN },
            body: JSON.stringify({ name: 'expiring', scopes: [ 'files:read' ], expiresInDays: 30 }),
        });
        const minted = await res.json() as CreateAccessTokenResponse;

        const expiresAt = Date.parse(minted.accessToken.expiresAt ?? '');
        const expectedMs = 30 * 24 * MS_PER_HOUR;

        expect(Math.abs(expiresAt - Date.now() - expectedMs)).toBeLessThan(MS_PER_HOUR);
    });

    it('rejects a mint with no scopes or an unknown scope as malformed', async () =>
    {
        for(const scopes of [ [], [ 'files:everything' ] ])
        {
            // eslint-disable-next-line no-await-in-loop -- two sequential cases against one app, order irrelevant
            const res = await booted.app.request(`${ ORIGIN }/api/me/access-tokens`, {
                method: 'POST',
                headers: { 'content-type': 'application/json', 'cookie': owner.cookie, 'origin': ORIGIN },
                body: JSON.stringify({ name: 'bad', scopes }),
            });

            expect(res.status).toBe(400);
        }
    });

    it('revokes a token dead immediately, and reads another user\'s token as absent', async () =>
    {
        const minted = await mintPat(owner, [ 'files:download' ]);
        const stranger = await makeUser(booted, 'stranger@example.com');

        const foreign = await booted.app.request(
            `${ ORIGIN }/api/me/access-tokens/${ minted.accessToken.id }`,
            { method: 'DELETE', headers: { cookie: stranger.cookie, origin: ORIGIN } }
        );
        expect(foreign.status).toBe(404);

        const revoked = await booted.app.request(
            `${ ORIGIN }/api/me/access-tokens/${ minted.accessToken.id }`,
            { method: 'DELETE', headers: { cookie: owner.cookie, origin: ORIGIN } }
        );
        expect(revoked.status).toBe(204);

        const after = await bearerRequest(`/api/nodes/${ uploaded.node.id }/download`, minted.token);
        expect(after.status).toBe(401);
    });
});

//----------------------------------------------------------------------------------------------------------------------

describe('the token credential plane', () =>
{
    it('serves bytes to a bearer token with the download action and no cookie, marked non-cacheable-shared', async () =>
    {
        const minted = await mintPat(owner, [ 'files:download' ]);

        const res = await bearerRequest(`/api/nodes/${ uploaded.node.id }/download`, minted.token);

        expect(res.status).toBe(200);
        expect((await bodyBytes(res)).equals(fixture)).toBe(true);
        expect(res.headers.get('cache-control')).toBe('private, no-cache');
    });

    it('serves bytes to the same token as a ?token= query param, Range included', async () =>
    {
        const minted = await mintPat(owner, [ 'files:download' ]);

        const res = await booted.app.request(
            `${ ORIGIN }/api/nodes/${ uploaded.node.id }/download?token=${ encodeURIComponent(minted.token) }`,
            { headers: { range: 'bytes=0-99' } }
        );

        expect(res.status).toBe(206);
        expect((await bodyBytes(res)).equals(fixture.subarray(0, 100))).toBe(true);
    });

    it('enforces exact containment: a download-only token cannot browse, a read token can', async () =>
    {
        const downloadOnly = await mintPat(owner, [ 'files:download' ]);
        const reader = await mintPat(owner, [ 'files:read' ]);

        const denied = await bearerRequest('/api/nodes/children', downloadOnly.token);
        expect(denied.status).toBe(401);

        const listed = await bearerRequest('/api/nodes/children', reader.token);
        expect(listed.status).toBe(200);

        // The read bundle stores the download action too, so the same key fetches bytes.
        const bytes = await bearerRequest(`/api/nodes/${ uploaded.node.id }/download`, reader.token);
        expect(bytes.status).toBe(200);
    });

    it('lets a write-scoped token rename, and refuses the same to a read token', async () =>
    {
        const writer = await mintPat(owner, [ 'files:write' ]);
        const reader = await mintPat(owner, [ 'files:read' ]);

        const refused = await bearerRequest(`/api/nodes/${ uploaded.node.id }`, reader.token, {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ name: 'renamed.mp3' }),
        });
        expect(refused.status).toBe(401);

        const renamed = await bearerRequest(`/api/nodes/${ uploaded.node.id }`, writer.token, {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ name: 'renamed.mp3' }),
        });
        expect(renamed.status).toBe(200);
    });

    it('prefers a live session over any token riding the same request', async () =>
    {
        const res = await booted.app.request(
            `${ ORIGIN }/api/nodes/${ uploaded.node.id }/download?token=garbage`,
            { headers: { cookie: owner.cookie } }
        );

        expect(res.status).toBe(200);
    });

    it('rejects tokens on every session-only surface: no laundering, no account writes, no destruction', async () =>
    {
        const full = await mintPat(owner, [ 'files:write', 'shares:write', 'account:read' ]);

        const laundering = await bearerRequest('/api/me/access-tokens', full.token, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ name: 'sneaky', scopes: [ 'files:download' ] }),
        });
        expect(laundering.status).toBe(401);

        const preferences = await bearerRequest('/api/me/preferences', full.token, {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ viewMode: 'list' }),
        });
        expect(preferences.status).toBe(401);

        const destruction = await bearerRequest(`/api/nodes/${ uploaded.node.id }`, full.token, {
            method: 'DELETE',
        });
        expect(destruction.status).toBe(401);

        const emptyTrash = await bearerRequest('/api/trash', full.token, { method: 'DELETE' });
        expect(emptyTrash.status).toBe(401);
    });

    it('lets an account:read token read the profile', async () =>
    {
        const minted = await mintPat(owner, [ 'account:read' ]);

        const res = await bearerRequest('/api/me', minted.token);
        const body = await res.json() as { email : string };

        expect(res.status).toBe(200);
        expect(body.email).toBe(owner.email);
    });
});

//----------------------------------------------------------------------------------------------------------------------

describe('playback tokens', () =>
{
    it('mints a prefixed download-only key expiring in about five hours, absent from the managed list', async () =>
    {
        const playback = await mintPlayback(owner);

        expect(playback.token.startsWith(PLAYBACK_TOKEN_PREFIX)).toBe(true);

        const expiresIn = Date.parse(playback.expiresAt) - Date.now();
        expect(expiresIn).toBeGreaterThan(4.5 * MS_PER_HOUR);
        expect(expiresIn).toBeLessThan(5.5 * MS_PER_HOUR);

        const bytes = await booted.app.request(
            `${ ORIGIN }/api/nodes/${ uploaded.node.id }/download?token=${ encodeURIComponent(playback.token) }`,
            {}
        );
        expect(bytes.status).toBe(200);

        const browse = await bearerRequest('/api/nodes/children', playback.token);
        expect(browse.status).toBe(401);

        const listRes = await booted.app.request(`${ ORIGIN }/api/me/access-tokens`, {
            headers: { cookie: owner.cookie },
        });
        const list = await listRes.json() as { accessTokens : unknown[] };
        expect(list.accessTokens).toHaveLength(0);
    });

    it('retires the named predecessor on refresh', async () =>
    {
        const first = await mintPlayback(owner);
        const second = await mintPlayback(owner, first.id);

        const dead = await bearerRequest(`/api/nodes/${ uploaded.node.id }/download`, first.token);
        expect(dead.status).toBe(401);

        const alive = await bearerRequest(`/api/nodes/${ uploaded.node.id }/download`, second.token);
        expect(alive.status).toBe(200);
    });
});

//----------------------------------------------------------------------------------------------------------------------

describe('tokens die with their owner\'s standing', () =>
{
    it('deletes every key when the owner is banned, so a ban sticks for outstanding credentials', async () =>
    {
        const minted = await mintPat(owner, [ 'files:download' ]);
        await mintPlayback(owner);

        // The admin plugin gates banUser on an admin session even in-process, so the ban travels the same path a
        // real admin action would -- which is exactly the path the database hook must cover.
        const adminCookie = await makeAdmin(booted, 'root@example.com', 'correct-horse-battery');
        await booted.auth.api.banUser({
            body: { userId: owner.id },
            headers: new Headers({ cookie: adminCookie }),
        });

        const rows = await sql<{ count : number }>`
            select count(*) as count from apikey where "referenceId" = ${ owner.id }
        `.execute(booted.handle.db);
        expect(rows.rows[0]?.count).toBe(0);

        const res = await bearerRequest(`/api/nodes/${ uploaded.node.id }/download`, minted.token);
        expect(res.status).toBe(401);
    });

    it('rejects a key whose owner row is gone, even when the key row survived', async () =>
    {
        const minted = await mintPat(owner, [ 'files:download' ]);

        // A raw delete bypasses better-auth's hooks entirely -- the orphaned key row is exactly the case the
        // seam's own user check exists for.
        await sql`delete from node where owner_id = ${ owner.id }`.execute(booted.handle.db);
        await sql`delete from "user" where id = ${ owner.id }`.execute(booted.handle.db);

        const rows = await sql<{ count : number }>`
            select count(*) as count from apikey where "referenceId" = ${ owner.id }
        `.execute(booted.handle.db);
        expect(rows.rows[0]?.count).toBeGreaterThan(0);

        const res = await bearerRequest(`/api/nodes/${ uploaded.node.id }/download`, minted.token);
        expect(res.status).toBe(401);
    });
});

//----------------------------------------------------------------------------------------------------------------------
