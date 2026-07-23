//----------------------------------------------------------------------------------------------------------------------
// Share Spec Support
//
// Composes the whole slice the sharing behaviors touch, wired the way app.ts wires it: real auth,
// a real in-memory database + migrations, a real fs blob backend under a temp dir, and the node, me, blob, upload,
// share, and access-request routes over real managers and RAs. The share and access-request routers mount at /api and
// coexist with /api/nodes -- the specs prove that composition routes correctly. onError uses the production
// mapManagerError, so specs drive the flow with app.request and read state through the real handle. Zero mocks.
//----------------------------------------------------------------------------------------------------------------------

/* eslint-disable camelcase -- setAvatarSha256 writes a snake_case DB column directly (house convention for Kysely) */

import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Hono } from 'hono';

// Resource Access
import { type Auth, createAuth } from '@server/resource-access/auth.ts';
import { BlobRA } from '@server/resource-access/blob/index.ts';
import { seedDefaultBackend } from '@server/resource-access/database/seeds.ts';
import { type DatabaseHandle, createDatabase } from '@server/resource-access/database/database.ts';
import { initialize } from '@server/resource-access/boot.ts';
import { NodeRA } from '@server/resource-access/nodes/node.ts';
import { ShareRA } from '@server/resource-access/shares/index.ts';
import { UserRA } from '@server/resource-access/users/index.ts';

// Managers
import { BlobManager } from '@server/managers/blob.ts';
import { DeletionOfferManager } from '@server/managers/deletionOffer.ts';
import { NodeManager } from '@server/managers/node.ts';
import { ShareManager } from '@server/managers/share.ts';
import { SessionManager } from '@server/managers/session.ts';
import { mapManagerError } from '@server/managers/errors.ts';

// Routes
import { createAccessRequestRoutes } from '@server/routes/accessRequests.ts';
import { createBlobRoutes } from '@server/routes/blobs.ts';
import { createDeletionOfferRoutes } from '@server/routes/deletionOffers.ts';
import { createMeRoutes } from '@server/routes/me.ts';
import { createNodeRoutes } from '@server/routes/nodes.ts';
import { createShareRoutes } from '@server/routes/shares.ts';
import { createUploadRoutes } from '@server/routes/uploads.ts';

// Auth support (real sign-up / sign-in over the same app)
import { ORIGIN, cookieFrom, signIn, signUp, testConfig } from '../auth/support.ts';

export { ORIGIN } from '../auth/support.ts';

//----------------------------------------------------------------------------------------------------------------------

export interface BootedShareApp
{
    app : Hono;
    handle : DatabaseHandle;
    auth : Auth;
    blob : BlobRA;
    backendID : string;
    storageRoot : string;
    cleanup : () => Promise<void>;
}

function composeApp(handle : DatabaseHandle, auth : Auth, blob : BlobRA, uploadMaxBytes : number) : Hono
{
    const sessions = new SessionManager(auth);
    const nodesRA = new NodeRA(handle);
    const sharesRA = new ShareRA(handle);
    const usersRA = new UserRA(handle);

    const blobs = new BlobManager({ handle, blob, uploadMaxBytes });
    const nodes = new NodeManager(handle, nodesRA, blob);
    const shares = new ShareManager(handle, nodesRA, sharesRA, usersRA);
    const deletionOffers = new DeletionOfferManager(handle, nodes);

    const app = new Hono();

    app.on([ 'POST', 'GET' ], '/api/auth/*', (ctx) => auth.handler(ctx.req.raw));
    app.route('/api', createNodeRoutes(sessions, nodes));
    app.route('/api', createMeRoutes(sessions, nodes));
    app.route('/api', createBlobRoutes(sessions, blobs));
    app.route('/api', createUploadRoutes(sessions, blobs));
    app.route('/api', createShareRoutes(sessions, shares));
    app.route('/api', createAccessRequestRoutes(sessions, shares));
    app.route('/api', createDeletionOfferRoutes(sessions, deletionOffers));

    app.notFound((ctx) => ctx.json({ error: 'Not Found' }, 404));
    app.onError((error, ctx) =>
    {
        const mapped = mapManagerError(error);
        if(mapped) { return ctx.json(mapped.body, mapped.status); }
        return ctx.json({ error: 'Internal Server Error' }, 500);
    });

    return app;
}

export async function bootShareApp() : Promise<BootedShareApp>
{
    const storageRoot = await mkdtemp(join(tmpdir(), 'fileshed-shares-'));
    const config = testConfig({ STORAGE_ROOT: storageRoot });

    const handle = createDatabase(config);
    const auth = createAuth(handle, config);
    await initialize(handle, auth, config);

    const backendID = await seedDefaultBackend(handle, config);
    const blob = new BlobRA(handle);

    return {
        app: composeApp(handle, auth, blob, config.UPLOAD_MAX_BYTES),
        handle,
        auth,
        blob,
        backendID,
        storageRoot,
        cleanup: async () =>
        {
            await handle.db.destroy();
            await rm(storageRoot, { recursive: true, force: true });
        },
    };
}

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
export async function makeUser(booted : BootedShareApp, email : string, name = 'Test User') : Promise<TestUser>
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

export function request(
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

// Points a user at an avatar hash directly, bypassing the upload flow -- enough to exercise avatarImage's derived
// URL on the grantee-summary path without standing up a blob backend.
export async function setAvatarSha256(booted : BootedShareApp, userID : string, sha256 : string) : Promise<void>
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

export function sha256Of(bytes : Buffer) : string
{
    return createHash('sha256').update(bytes)
        .digest('hex');
}

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
