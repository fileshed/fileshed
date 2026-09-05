//----------------------------------------------------------------------------------------------------------------------
// Public Link / Download Spec Support
//
// Boots the real serving slice end to end: a fresh in-memory database (real factory + migrations + admin bootstrap), a
// real BlobRA over an fs facade under a per-run temp directory, the real BlobManager (to land actual file bytes via the
// claim/upload flow), the real NodeManager (to create folders and trash), and the real PublicLinkManager behind its
// direct/download/link-management routes. onError routes through mapManagerError, exactly as the integrated app will.
// Specs drive the flow with app.request over REAL streamed bytes -- zero mocks.
//
// Download authorization runs through the REAL ShareRA-backed resolver, wired the same way app.ts wires it, and grants
// are real share rows minted over the real share route. A hand-rolled resolver here would make every authorization
// assertion vacuous: it could not fail for a share-resolution regression, which is precisely what it must catch.
//----------------------------------------------------------------------------------------------------------------------

import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';

import { Hono } from 'hono';
import { createId } from '@paralleldrive/cuid2';

import {
    type ClaimResponse,
    DEFAULT_UPLOAD_CHUNK_BYTES,
    type NodeResponse,
    type ShareRole,
    UNLIMITED_QUOTA,
} from '@fileshed/core';

// Resource Access
import { type Auth, createAuth } from '@server/resource-access/auth.ts';
import { BlobRA } from '@server/resource-access/blob/index.ts';
import { MediaTagsRA } from '@server/resource-access/mediaTags/index.ts';
import type { DatabaseHandle } from '@server/resource-access/database/database.ts';
import { NodeRA } from '@server/resource-access/nodes/node.ts';
import { PublicLinkRA } from '@server/resource-access/publicLinks/index.ts';
import { ShareRA } from '@server/resource-access/shares/index.ts';
import { UserRA } from '@server/resource-access/users/index.ts';
import { initialize } from '@server/resource-access/boot.ts';
import { seedDefaultBackend } from '@server/resource-access/database/seeds.ts';

// Managers
import { AccessTokenManager } from '@server/managers/accessToken.ts';
import { BlobManager } from '@server/managers/blob.ts';
import { MediaTagManager } from '@server/managers/mediaTags.ts';
import { NodeManager } from '@server/managers/node.ts';
import { PublicLinkManager } from '@server/managers/publicLink.ts';
import { SessionManager } from '@server/managers/session.ts';
import { ShareManager } from '@server/managers/share.ts';
import { mapManagerError } from '@server/managers/errors.ts';

// Routes
import { createBlobRoutes } from '@server/routes/blobs.ts';
import { createDirectRoutes } from '@server/routes/direct.ts';
import { createAccessTokenRoutes } from '@server/routes/accessTokens.ts';
import { createDownloadRoutes } from '@server/routes/downloads.ts';
import { createMeRoutes } from '@server/routes/me.ts';
import { createNodeRoutes } from '@server/routes/nodes.ts';
import { createPublicLinkRoutes } from '@server/routes/links.ts';
import { createShareRoutes } from '@server/routes/shares.ts';
import { createUploadRoutes } from '@server/routes/uploads.ts';

// Auth support (real sign-up/sign-in over the same app)
import { ORIGIN, TEST_AUTH_SECRET, cookieFrom, signIn, signUp, testConfig } from '../auth/support.ts';
import { openTestDatabase } from '../support/database.ts';

export { ORIGIN } from '../auth/support.ts';

//----------------------------------------------------------------------------------------------------------------------

export interface BootedServeApp
{
    app : Hono;
    handle : DatabaseHandle;
    auth : Auth;
    blob : BlobRA;
    cleanup : () => Promise<void>;
}

// The graveyard collaborator is irrelevant to serving; a no-op stands in (its real home is the upload/GC side).
const noopOrphanedBlobs = { async graveyardUnreferenced() { /* serving specs do not exercise the graveyard */ } };

function composeApp(auth : Auth, handle : DatabaseHandle, blob : BlobRA) : Hono
{
    const sessions = new SessionManager(auth);
    const nodeRA = new NodeRA(handle);
    const shareRA = new ShareRA(handle);
    const userRA = new UserRA(handle);
    const linkRA = new PublicLinkRA(handle);

    const blobs = new BlobManager({
        handle,
        blob,
        uploadMaxBytes: async () => 5 * 1024 * 1024 * 1024,
        uploadChunkBytes: DEFAULT_UPLOAD_CHUNK_BYTES,
        defaultQuota: async () => UNLIMITED_QUOTA,
    });
    const mediaTags = new MediaTagManager({ blob, tags: new MediaTagsRA(handle) });
    const nodes = new NodeManager(handle, nodeRA, noopOrphanedBlobs, { defaultQuota: async () => UNLIMITED_QUOTA });
    const shares = new ShareManager(handle, nodeRA, shareRA, userRA);

    // The REAL share-aware resolver, wired exactly as app.ts wires it -- so these specs exercise the authorization
    // that actually ships. A hand-rolled double here could not fail for any share-resolution regression.
    const links = new PublicLinkManager(
        nodeRA,
        blob,
        linkRA,
        (userID, nodeID) => shareRA.effectiveRole(userID, nodeID)
    );

    const app = new Hono();

    app.on([ 'POST', 'GET' ], '/api/auth/*', (ctx) => auth.handler(ctx.req.raw));
    app.route('/api', createAccessTokenRoutes(sessions, new AccessTokenManager(auth)));
    app.route('/api', createMeRoutes(sessions, nodes));
    app.route('/api', createBlobRoutes(sessions, blobs, mediaTags));
    app.route('/api', createUploadRoutes(sessions, blobs, mediaTags));
    app.route('/api', createNodeRoutes(sessions, nodes));
    app.route('/api', createShareRoutes(sessions, shares));
    app.route('/api', createDownloadRoutes(sessions, links));
    app.route('/api', createPublicLinkRoutes(sessions, links));
    app.route('/d', createDirectRoutes(links));

    app.notFound((ctx) => ctx.json({ error: 'Not Found' }, 404));
    app.onError((error, ctx) =>
    {
        const mapped = mapManagerError(error);
        if(mapped) { return ctx.json(mapped.body, mapped.status, mapped.headers); }
        return ctx.json({ error: 'Internal Server Error' }, 500);
    });

    return app;
}

export async function bootServeApp() : Promise<BootedServeApp>
{
    const storageRoot = await mkdtemp(join(tmpdir(), 'fileshed-serve-'));
    const { config, handle, dispose } = await openTestDatabase(testConfig({ STORAGE_ROOT: storageRoot }));

    const auth = createAuth(handle, config, TEST_AUTH_SECRET);
    await initialize(handle, auth);
    await seedDefaultBackend(handle, config);

    const blob = new BlobRA(handle);

    return {
        app: composeApp(auth, handle, blob),
        handle,
        auth,
        blob,
        cleanup: async () =>
        {
            await dispose();
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
}

export async function makeUser(booted : BootedServeApp, email : string) : Promise<TestUser>
{
    const password = 'correct-horse-battery';
    await signUp(booted.app, email, password);
    const cookie = cookieFrom(await signIn(booted.app, email, password));

    const row = await booted.handle.db
        .selectFrom('user')
        .select('id')
        .where('email', '=', email)
        .executeTakeFirstOrThrow();

    return { id: row.id, cookie, email };
}

//----------------------------------------------------------------------------------------------------------------------
// Content: land a real file node with real bytes via the claim + upload flow (small-file path).
//----------------------------------------------------------------------------------------------------------------------

function sha256Hex(data : Buffer) : string
{
    return createHash('sha256')
        .update(data)
        .digest('hex');
}

export interface UploadedFile
{
    node : NodeResponse & { type : 'file' };
    sha256 : string;
}

export async function uploadFile(
    booted : BootedServeApp,
    user : TestUser,
    data : Buffer,
    meta : { name ?: string; mimeType ?: string; parentID ?: string } = {}
) : Promise<UploadedFile>
{
    const name = meta.name ?? 'file.bin';
    const mimeType = meta.mimeType ?? 'application/octet-stream';
    const sha256 = sha256Hex(data);

    const claimRes = await booted.app.request(`${ ORIGIN }/api/blobs/claim`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'cookie': user.cookie },
        body: JSON.stringify({ sha256, size: data.length }),
    });
    const claim = await claimRes.json() as ClaimResponse;
    if(!claim.upload) { throw new Error('expected an upload ticket for a fresh small blob'); }

    const params = new URLSearchParams({ name, mimeType });
    if(meta.parentID !== undefined) { params.set('parentID', meta.parentID); }

    const putRes = await booted.app.request(`${ ORIGIN }/api/uploads/${ claim.ticket }?${ params.toString() }`, {
        method: 'PUT',
        headers: { cookie: user.cookie },
        body: new Uint8Array(data),
    });

    const node = await putRes.json() as NodeResponse;
    if(node.type !== 'file') { throw new Error('upload did not yield a file node'); }

    return { node, sha256 };
}

// Write a mime type straight onto a stored node, bypassing every codec. What a row stored before the mime type was
// validated looks like -- there is no API left that can produce one, which is exactly why serving must survive it.
export async function forceMimeType(booted : BootedServeApp, nodeID : string, mimeType : string) : Promise<void>
{
    await booted.handle.db
        .updateTable('node')
        // eslint-disable-next-line camelcase -- a snake_case DB column (house convention)
        .set({ mime_type: mimeType })
        .where('id', '=', nodeID)
        .execute();
}

export async function createFolder(booted : BootedServeApp, user : TestUser, name = 'folder') : Promise<NodeResponse>
{
    const res = await booted.app.request(`${ ORIGIN }/api/nodes`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'cookie': user.cookie },
        body: JSON.stringify({ type: 'folder', name }),
    });
    return res.json() as Promise<NodeResponse>;
}

export function trashNode(booted : BootedServeApp, user : TestUser, nodeID : string) : Promise<Response>
{
    return booted.app.request(`${ ORIGIN }/api/nodes/${ nodeID }/trash`, {
        method: 'POST',
        headers: { cookie: user.cookie },
    });
}

// A REAL share grant, minted by the owner over the real share route -- the grant the real resolver reads back when it
// authorizes a download. Nothing here fakes a role.
export async function shareWith(
    booted : BootedServeApp,
    owner : TestUser,
    nodeID : string,
    granteeUserID : string,
    role : ShareRole = 'viewer'
) : Promise<Response>
{
    const res = await booted.app.request(`${ ORIGIN }/api/nodes/${ nodeID }/shares`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'cookie': owner.cookie },
        body: JSON.stringify({ granteeUserID, role }),
    });

    if(res.status !== 201) { throw new Error(`share grant failed: ${ res.status } ${ await res.text() }`); }

    return res;
}

//----------------------------------------------------------------------------------------------------------------------
// A zero-byte file, staged straight to the blob store and node rows -- a serving test wants the empty-blob edge case
// in place without the ceremony of a claim/upload round trip.
//----------------------------------------------------------------------------------------------------------------------

const EMPTY_SHA256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

export async function seedEmptyFile(booted : BootedServeApp, user : TestUser, name = 'empty.bin') : Promise<string>
{
    const location = await booted.blob.put(EMPTY_SHA256, Readable.from([]), 0);
    await booted.blob.insertOrResurrect({
        sha256: EMPTY_SHA256,
        size: 0,
        backendID: location.backendID,
        storageKey: location.storageKey,
    });

    const id = createId();
    const now = new Date();
    await new NodeRA(booted.handle).insert({
        type: 'file',
        id,
        name,
        ownerID: user.id,
        parentID: null,
        blobID: EMPTY_SHA256,
        size: 0,
        mimeType: 'application/octet-stream',
        createdAt: now,
        updatedAt: now,
        trashedAt: null,
    });

    return id;
}

//----------------------------------------------------------------------------------------------------------------------
// Link management
//----------------------------------------------------------------------------------------------------------------------

// Minting takes no body: a link has nothing to configure. `body`, when a spec passes one, is what that spec is about --
// proving the endpoint gives it no meaning.
export function createLink(
    booted : BootedServeApp,
    user : TestUser,
    nodeID : string,
    body ?: Record<string, unknown>
) : Promise<Response>
{
    const headers : Record<string, string> = { cookie: user.cookie };
    if(body !== undefined) { headers['content-type'] = 'application/json'; }

    return booted.app.request(`${ ORIGIN }/api/nodes/${ nodeID }/links`, {
        method: 'POST',
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
    });
}

export function listLinks(booted : BootedServeApp, user : TestUser, nodeID : string) : Promise<Response>
{
    return booted.app.request(`${ ORIGIN }/api/nodes/${ nodeID }/links`, {
        headers: { cookie: user.cookie },
    });
}

export function revokeLink(booted : BootedServeApp, user : TestUser, linkID : string) : Promise<Response>
{
    return booted.app.request(`${ ORIGIN }/api/links/${ linkID }`, {
        method: 'DELETE',
        headers: { cookie: user.cookie },
    });
}

//----------------------------------------------------------------------------------------------------------------------
// Byte serving
//----------------------------------------------------------------------------------------------------------------------

export interface ServeHeaders
{
    range ?: string;
    ifNoneMatch ?: string;
}

function serveHeaders(extra : ServeHeaders, cookie ?: string) : Record<string, string>
{
    const headers : Record<string, string> = {};
    if(cookie !== undefined) { headers.cookie = cookie; }
    if(extra.range !== undefined) { headers.range = extra.range; }
    if(extra.ifNoneMatch !== undefined) { headers['if-none-match'] = extra.ifNoneMatch; }
    return headers;
}

// GET /d/:token -- anonymous, no cookie by design. `query` is the raw query string, spelled out at the call site
// because the exact spelling is what the disposition specs are asserting.
export function getDirect(
    booted : BootedServeApp,
    token : string,
    extra : ServeHeaders = {},
    query = ''
) : Promise<Response>
{
    return booted.app.request(`${ ORIGIN }/d/${ token }${ query }`, { headers: serveHeaders(extra) });
}

export function getDownload(
    booted : BootedServeApp,
    cookie : string | undefined,
    nodeID : string,
    query : { disposition ?: string } = {},
    extra : ServeHeaders = {}
) : Promise<Response>
{
    const params = query.disposition === undefined ? '' : `?disposition=${ query.disposition }`;
    return booted.app.request(`${ ORIGIN }/api/nodes/${ nodeID }/download${ params }`, {
        headers: serveHeaders(extra, cookie),
    });
}

export async function bodyBytes(res : Response) : Promise<Buffer>
{
    return Buffer.from(await res.arrayBuffer());
}

//----------------------------------------------------------------------------------------------------------------------
