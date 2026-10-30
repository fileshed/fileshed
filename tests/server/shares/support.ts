//----------------------------------------------------------------------------------------------------------------------
// Share Spec Support
//----------------------------------------------------------------------------------------------------------------------

/* eslint-disable camelcase -- setAvatarSha256 writes a snake_case DB column directly (house convention for Kysely) */

import type { Hono } from 'hono';

// Support
import { sha256Of } from '../support/sha256.ts';
import { ORIGIN, cookieFrom, signIn, signUp } from '../auth/support.ts';
import type { BootedStoreApp } from '../support/storeApp.ts';

export { ORIGIN } from '../auth/support.ts';
export { type BootedStoreApp, bootStoreApp } from '../support/storeApp.ts';

//----------------------------------------------------------------------------------------------------------------------
// Users
//----------------------------------------------------------------------------------------------------------------------

export interface TestUser
{
    id : string;
    cookie : string;
    email : string;
    name : string;
}

// Sign up and sign in, returning the user's id (as the FKs see it), their display name, and their session cookie.
export async function makeUser(booted : BootedStoreApp, email : string, name = 'Test User') : Promise<TestUser>
{
    const password = 'correct-horse-battery';
    await signUp(booted.app, email, password, name);
    const cookie = cookieFrom(await signIn(booted.app, email, password));

    const row = await booted.handle.db
        .selectFrom('user')
        .select('id')
        .where('email', '=', email)
        .executeTakeFirstOrThrow();

    return { id: row.id, cookie, email, name };
}

//----------------------------------------------------------------------------------------------------------------------
// HTTP
//----------------------------------------------------------------------------------------------------------------------

export async function request(
    app : Hono,
    method : string,
    path : string,
    cookie ?: string,
    body ?: unknown
) : Promise<Response>
{
    const headers : Record<string, string> = {};
    if(cookie) { headers['cookie'] = cookie; }
    if(body !== undefined) { headers['content-type'] = 'application/json'; }

    return app.request(`${ ORIGIN }${ path }`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
    });
}

// Create a folder and return its id -- the building block for the shared-subtree scenarios.
export async function createFolder(
    app : Hono,
    cookie : string,
    name : string,
    parentID : string | null = null
) : Promise<string>
{
    const res = await request(app, 'POST', '/api/nodes', cookie, { type: 'folder', name, parentID });
    if(res.status !== 201) { throw new Error(`createFolder failed: ${ res.status } ${ await res.text() }`); }

    const body = await res.json() as { id : string };
    return body.id;
}

// Grant a share; returns the raw response so a spec can assert status as well as body.
export function grantShare(
    app : Hono,
    cookie : string,
    nodeID : string,
    granteeUserID : string,
    role : 'viewer' | 'editor'
) : Promise<Response>
{
    return request(app, 'POST', `/api/nodes/${ nodeID }/shares`, cookie, { granteeUserID, role });
}

// URL on the grantee-summary path without standing up a blob backend.
export async function setAvatarSha256(booted : BootedStoreApp, userID : string, sha256 : string) : Promise<void>
{
    await booted.handle.db
        .updateTable('user')
        .set({ avatar_sha256: sha256 })
        .where('id', '=', userID)
        .execute();
}

//----------------------------------------------------------------------------------------------------------------------
// Small-file upload into a folder (drives the blob commit path, the second create path into a shared folder)
//----------------------------------------------------------------------------------------------------------------------

// Claim + PUT a small file into `parentID`, returning the upload response. Small (< 1 MiB) unknown blobs take the
// ticket path (no proof dance), so this is one claim then one PUT -- enough to exercise the commit-time parent-edge
// gate that authorizes an editor's upload into a shared folder.
export async function uploadSmallFile(
    app : Hono,
    cookie : string,
    bytes : Buffer,
    parentID : string | null,
    name = 'file.bin'
) : Promise<Response>
{
    const sha256 = sha256Of(bytes);

    const claimRes = await request(app, 'POST', '/api/blobs/claim', cookie, { sha256, size: bytes.length });
    if(claimRes.status !== 200) { return claimRes; }

    const claim = await claimRes.json() as { upload : boolean; ticket ?: string };
    if(!claim.upload || claim.ticket === undefined)
    {
        throw new Error('expected an upload ticket for an unknown blob');
    }

    const params = new URLSearchParams({ name, mimeType: 'application/octet-stream' });
    if(parentID !== null) { params.set('parentID', parentID); }

    return app.request(`${ ORIGIN }/api/uploads/${ claim.ticket }?${ params.toString() }`, {
        method: 'PUT',
        headers: { cookie },
        body: new Uint8Array(bytes),
    });
}

//----------------------------------------------------------------------------------------------------------------------
