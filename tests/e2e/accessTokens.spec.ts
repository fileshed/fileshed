//----------------------------------------------------------------------------------------------------------------------
// E2E — Access tokens over real sockets
//
// The token plane end to end: a session mints a scoped PAT whose value appears exactly once and whose hash -- never
// the value -- lands in the apikey row; a cookie-less client fetches bytes with it as a bearer header and as a
// ?token= query param, Range included; scope containment separates download-only, read, and write credentials on
// the live wire; session-only surfaces (minting, permanent deletion) refuse tokens outright; revocation kills the
// credential immediately; playback tokens expire in about five hours, serve bytes, stay out of the managed list, and
// retire their named predecessor. The plugin's own HTTP endpoints answer 404 even to a valid session.
//----------------------------------------------------------------------------------------------------------------------

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
    ACCESS_TOKEN_PREFIX,
    type AccessTokenListResponse,
    type ClaimResponse,
    type CreateAccessTokenResponse,
    MS_PER_HOUR,
    type NodeResponse,
    PLAYBACK_TOKEN_PREFIX,
    type PlaybackTokenResponse,
} from '@fileshed/core';

// Support
import { ApiClient, type ServerHandle, sha256Of, smallFixture, spawnServer, withDb } from './support.ts';

//----------------------------------------------------------------------------------------------------------------------

const PASSWORD = 'correct-horse-battery';

const data = smallFixture('token-file');

let server : ServerHandle;
let owner : ApiClient;
let fileID : string;

async function upload(client : ApiClient, name : string, bytes : Buffer) : Promise<NodeResponse>
{
    const claim = await (await client.post('/api/blobs/claim', { sha256: sha256Of(bytes), size: bytes.length }))
        .json() as ClaimResponse;
    if(claim.upload !== true) { throw new Error('expected an upload ticket'); }

    const params = new URLSearchParams({ name, mimeType: 'audio/mpeg' });

    return await (await client.put(`/api/uploads/${ claim.ticket }?${ params.toString() }`, bytes))
        .json() as NodeResponse;
}

async function mintPat(scopes : string[], name = 'e2e token') : Promise<CreateAccessTokenResponse>
{
    const res = await owner.post('/api/me/access-tokens', { name, scopes });
    expect(res.status).toBe(200);

    return await res.json() as CreateAccessTokenResponse;
}

// A cookie-less fetch: raw, no jar -- exactly what a script or a cast receiver sends.
function bearer(path : string, token : string, init : RequestInit = {}) : Promise<Response>
{
    return fetch(`${ server.baseURL }${ path }`, {
        ...init,
        headers: { ...init.headers as Record<string, string>, authorization: `Bearer ${ token }` },
    });
}

async function bearerStatus(path : string, token : string, init : RequestInit = {}) : Promise<number>
{
    const res = await bearer(path, token, init);
    await res.arrayBuffer();
    return res.status;
}

//----------------------------------------------------------------------------------------------------------------------

beforeAll(async () =>
{
    server = await spawnServer();
    owner = new ApiClient(server.baseURL);
    await owner.signUp('tokens@example.com', PASSWORD);
    fileID = (await upload(owner, 'track.mp3', data)).id;
});

afterAll(async () =>
{
    await server.stop();
});

//----------------------------------------------------------------------------------------------------------------------

describe('personal access tokens over the wire', () =>
{
    it('mints a one-time value, stores only a hash, and serves bytes to a cookie-less bearer', async () =>
    {
        const minted = await mintPat([ 'files:download' ], 'bearer token');

        expect(minted.token.startsWith(ACCESS_TOKEN_PREFIX)).toBe(true);

        const stored = await withDb(server, async (db) =>
        {
            return db.selectFrom('apikey' as never)
                .select([ 'key' as never, 'configId' as never ])
                .execute() as Promise<{ key : string; configId : string }[]>;
        });
        expect(stored.some((row) => row.key === minted.token)).toBe(false);
        expect(stored.every((row) => row.key.length > 0)).toBe(true);

        const res = await bearer(`/api/nodes/${ fileID }/download`, minted.token);
        expect(res.status).toBe(200);
        expect(res.headers.get('cache-control')).toBe('private, no-cache');
        expect(Buffer.from(await res.arrayBuffer()).equals(data)).toBe(true);
    });

    it('serves a Range to the ?token= form -- the URL a cast receiver is handed', async () =>
    {
        const minted = await mintPat([ 'files:download' ], 'query token');

        const res = await fetch(
            `${ server.baseURL }/api/nodes/${ fileID }/download?token=${ encodeURIComponent(minted.token) }`,
            { headers: { range: 'bytes=0-49' } }
        );

        expect(res.status).toBe(206);
        expect(Buffer.from(await res.arrayBuffer()).equals(data.subarray(0, 50))).toBe(true);
    });

    it('separates the scopes on the live wire: download-only cannot browse, read cannot write', async () =>
    {
        const downloadOnly = await mintPat([ 'files:download' ], 'narrow');
        const reader = await mintPat([ 'files:read' ], 'reader');

        expect(await bearerStatus('/api/nodes/children', downloadOnly.token)).toBe(401);
        expect(await bearerStatus('/api/nodes/children', reader.token)).toBe(200);
        expect(await bearerStatus(`/api/nodes/${ fileID }`, reader.token, {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ name: 'nope.mp3' }),
        })).toBe(401);
    });

    it('refuses tokens on session-only surfaces: no minting, no permanent deletion', async () =>
    {
        const full = await mintPat([ 'files:write', 'shares:write', 'account:read' ], 'full');

        expect(await bearerStatus('/api/me/access-tokens', full.token, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ name: 'laundered', scopes: [ 'files:download' ] }),
        })).toBe(401);

        expect(await bearerStatus(`/api/nodes/${ fileID }`, full.token, { method: 'DELETE' })).toBe(401);
    });

    it('kills a revoked token immediately', async () =>
    {
        const minted = await mintPat([ 'files:download' ], 'doomed');

        expect(await bearerStatus(`/api/nodes/${ fileID }/download`, minted.token)).toBe(200);

        const revoked = await owner.del(`/api/me/access-tokens/${ minted.accessToken.id }`);
        expect(revoked.status).toBe(204);

        expect(await bearerStatus(`/api/nodes/${ fileID }/download`, minted.token)).toBe(401);
    });

    it('keeps the plugin\'s own endpoints gated shut, even for a valid session', async () =>
    {
        const res = await owner.post('/api/auth/api-key/create', { name: 'sneaky' });

        expect(res.status).toBe(404);
    });
});

//----------------------------------------------------------------------------------------------------------------------

describe('playback tokens over the wire', () =>
{
    it('mints a five-hour download-only key that serves bytes, hidden from the managed list', async () =>
    {
        const res = await owner.post('/api/me/playback-token', { previousID: null });
        expect(res.status).toBe(200);
        const playback = await res.json() as PlaybackTokenResponse;

        expect(playback.token.startsWith(PLAYBACK_TOKEN_PREFIX)).toBe(true);

        const expiresIn = Date.parse(playback.expiresAt) - Date.now();
        expect(expiresIn).toBeGreaterThan(4.5 * MS_PER_HOUR);
        expect(expiresIn).toBeLessThan(5.5 * MS_PER_HOUR);

        const bytes = await fetch(
            `${ server.baseURL }/api/nodes/${ fileID }/download?token=${ encodeURIComponent(playback.token) }`
        );
        expect(bytes.status).toBe(200);
        await bytes.arrayBuffer();

        expect(await bearerStatus('/api/nodes/children', playback.token)).toBe(401);

        const list = await (await owner.get('/api/me/access-tokens')).json() as AccessTokenListResponse;
        expect(list.accessTokens.every((token) => !token.start?.startsWith(PLAYBACK_TOKEN_PREFIX))).toBe(true);
    });

    it('retires the named predecessor on refresh', async () =>
    {
        const first = await (await owner.post('/api/me/playback-token', { previousID: null }))
            .json() as PlaybackTokenResponse;
        const second = await (await owner.post('/api/me/playback-token', { previousID: first.id }))
            .json() as PlaybackTokenResponse;

        expect(await bearerStatus(`/api/nodes/${ fileID }/download`, first.token)).toBe(401);
        expect(await bearerStatus(`/api/nodes/${ fileID }/download`, second.token)).toBe(200);
    });
});

//----------------------------------------------------------------------------------------------------------------------
