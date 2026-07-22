//----------------------------------------------------------------------------------------------------------------------
// Blob Flow Spec Support
//
// Boots the real claim/PoP/upload slice end to end: a fresh in-memory database (real factory + migrations + admin
// bootstrap), a real BlobRA over an fs facade under a per-run temp directory, the real BlobManager, and a Hono
// app that mounts the real auth handler alongside the blob and upload routes. onError routes through mapManagerError,
// the same translation the integrated app uses -- so specs drive the flow with app.request and read state through the
// real handle and storage RA, zero mocks.
//----------------------------------------------------------------------------------------------------------------------

/* eslint-disable camelcase -- reads/writes name snake_case DB columns (house convention for Kysely) */

import { createHmac } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Readable } from 'node:stream';

import { Hono } from 'hono';

// Resource Access
import { type Auth, createAuth } from '@server/resource-access/auth.ts';
import { type BlobLocation, BlobNotFoundError, BlobRA } from '@server/resource-access/blob/index.ts';
import { seedDefaultBackend } from '@server/resource-access/database/seeds.ts';
import { type DatabaseHandle, createDatabase } from '@server/resource-access/database/database.ts';
import { initialize } from '@server/resource-access/boot.ts';

// Managers
import { BlobManager } from '@server/managers/blob.ts';
import { mapManagerError } from '@server/managers/errors.ts';
import { SessionManager } from '@server/managers/session.ts';

// Routes
import { createBlobRoutes } from '@server/routes/blobs.ts';
import { createUploadRoutes } from '@server/routes/uploads.ts';

// Auth support (real sign-up/sign-in over the same app)
import { ORIGIN, cookieFrom, signIn, signUp, testConfig } from '../auth/support.ts';

export { ORIGIN, cookieFrom, signIn, signUp } from '../auth/support.ts';

//----------------------------------------------------------------------------------------------------------------------

export interface BootedBlobApp
{
    app : Hono;
    handle : DatabaseHandle;
    auth : Auth;
    blob : BlobRA;
    backendID : string;
    blobs : BlobManager;
    storageRoot : string;
    cleanup : () => Promise<void>;
}

function composeApp(auth : Auth, blobs : BlobManager) : Hono
{
    const app = new Hono();
    const sessions = new SessionManager(auth);

    app.on([ 'POST', 'GET' ], '/api/auth/*', (ctx) => auth.handler(ctx.req.raw));
    app.route('/api', createBlobRoutes(sessions, blobs));
    app.route('/api', createUploadRoutes(sessions, blobs));

    app.notFound((ctx) => ctx.json({ error: 'Not Found' }, 404));
    app.onError((error, ctx) =>
    {
        const mapped = mapManagerError(error);
        if(mapped) { return ctx.json(mapped.body, mapped.status); }
        return ctx.json({ error: 'Internal Server Error' }, 500);
    });

    return app;
}

export async function bootBlobApp(uploadMaxBytes ?: number) : Promise<BootedBlobApp>
{
    const storageRoot = await mkdtemp(join(tmpdir(), 'fileshed-blob-flow-'));
    const overrides = uploadMaxBytes === undefined ? {} : { UPLOAD_MAX_BYTES: uploadMaxBytes };
    const config = testConfig({ STORAGE_ROOT: storageRoot, ...overrides });

    const handle = createDatabase(config);
    const auth = createAuth(handle, config);
    await initialize(handle, auth, config);

    const backendID = await seedDefaultBackend(handle, config);
    const blob = new BlobRA(handle);
    const blobs = new BlobManager({ handle, blob, uploadMaxBytes: config.UPLOAD_MAX_BYTES });

    return {
        app: composeApp(auth, blobs),
        handle,
        auth,
        blob,
        backendID,
        blobs,
        storageRoot,
        cleanup: async () =>
        {
            await handle.db.destroy();
            await rm(storageRoot, { recursive: true, force: true });
        },
    };
}

//----------------------------------------------------------------------------------------------------------------------
// A signed-in user: their id (as the FKs and quotas see it) and their session cookie.
//----------------------------------------------------------------------------------------------------------------------

export interface TestUser
{
    id : string;
    cookie : string;
    email : string;
}

// Sign up, optionally set a quota_limit before signing in (a cached session snapshots quota at sign-in, so it must be
// set first -- mirrors makeAdmin's role flip), then sign in for a session that reflects it.
export async function makeUser(
    booted : BootedBlobApp,
    email : string,
    quotaLimit : number | null = null
) : Promise<TestUser>
{
    const password = 'correct-horse-battery';
    await signUp(booted.app, email, password);

    if(quotaLimit !== null)
    {
        await booted.handle.db.updateTable('user').set({ quota_limit: quotaLimit })
            .where('email', '=', email)
            .execute();
    }

    const cookie = cookieFrom(await signIn(booted.app, email, password));

    const row = await booted.handle.db.selectFrom('user').select('id')
        .where('email', '=', email)
        .executeTakeFirstOrThrow();

    return { id: row.id, cookie, email };
}

//----------------------------------------------------------------------------------------------------------------------
// Flow HTTP helpers
//----------------------------------------------------------------------------------------------------------------------

export interface CommitMetadata
{
    name : string;
    parentID : string | null;
    mimeType : string;
}

const defaultMetadata : CommitMetadata = { name: 'file.bin', parentID: null, mimeType: 'application/octet-stream' };

export function claim(app : Hono, cookie : string, sha256 : string, size : number) : Promise<Response>
{
    return app.request(`${ ORIGIN }/api/blobs/claim`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify({ sha256, size }),
    });
}

export function answerChallenge(
    app : Hono,
    cookie : string,
    challengeID : string,
    answer : string,
    metadata : CommitMetadata = defaultMetadata
) : Promise<Response>
{
    return app.request(`${ ORIGIN }/api/blobs/claim/${ challengeID }`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify({ answer, ...metadata }),
    });
}

export function putUpload(
    app : Hono,
    cookie : string,
    ticket : string,
    bytes : Buffer,
    metadata : CommitMetadata = defaultMetadata
) : Promise<Response>
{
    const params = new URLSearchParams({ name: metadata.name, mimeType: metadata.mimeType });
    if(metadata.parentID !== null) { params.set('parentID', metadata.parentID); }

    return app.request(`${ ORIGIN }/api/uploads/${ ticket }?${ params.toString() }`, {
        method: 'PUT',
        headers: { cookie },
        body: new Uint8Array(bytes),
    });
}

// The replace variant of the upload commit: replaceNodeID (and an optional overriding mimeType) ride the query string
// instead of the create metadata, so a completed upload overwrites an existing file's content in place.
export function putReplace(
    app : Hono,
    cookie : string,
    ticket : string,
    bytes : Buffer,
    replaceNodeID : string,
    mimeType ?: string
) : Promise<Response>
{
    const params = new URLSearchParams({ replaceNodeID });
    if(mimeType !== undefined) { params.set('mimeType', mimeType); }

    return app.request(`${ ORIGIN }/api/uploads/${ ticket }?${ params.toString() }`, {
        method: 'PUT',
        headers: { cookie },
        body: new Uint8Array(bytes),
    });
}

// The replace variant of the proof-of-possession answer: the body carries replaceNodeID (and an optional mimeType)
// instead of the create metadata, so a proven dedup overwrites an existing file's content with zero bytes moved.
export function answerReplace(
    app : Hono,
    cookie : string,
    challengeID : string,
    answer : string,
    replaceNodeID : string,
    mimeType ?: string
) : Promise<Response>
{
    const body = mimeType === undefined ? { answer, replaceNodeID } : { answer, replaceNodeID, mimeType };

    return app.request(`${ ORIGIN }/api/blobs/claim/${ challengeID }`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify(body),
    });
}

//----------------------------------------------------------------------------------------------------------------------
// Client-side proof, computed from the fixture bytes the way a possessing client would.
//----------------------------------------------------------------------------------------------------------------------

export function computeAnswer(nonce : string, ranges : [ number, number ][], data : Buffer) : string
{
    const hmac = createHmac('sha256', nonce);
    for(const [ offset, length ] of ranges)
    {
        hmac.update(data.subarray(offset, offset + length));
    }
    return hmac.digest('hex');
}

//----------------------------------------------------------------------------------------------------------------------
// Byte readers (through the blob RA -- the fs backend keys by sha256, so the location is { backendID, storageKey })
//----------------------------------------------------------------------------------------------------------------------

function locationOf(booted : BootedBlobApp, sha256 : string) : BlobLocation
{
    return { backendID: booted.backendID, storageKey: sha256 };
}

async function collect(stream : Readable) : Promise<Buffer>
{
    const chunks : Buffer[] = [];
    for await (const chunk of stream) { chunks.push(chunk as Buffer); }
    return Buffer.concat(chunks);
}

export async function storedBytes(booted : BootedBlobApp, sha256 : string) : Promise<Buffer>
{
    return collect(await booted.blob.getStream(locationOf(booted, sha256)));
}

export async function bytesExist(booted : BootedBlobApp, sha256 : string) : Promise<boolean>
{
    try
    {
        await storedBytes(booted, sha256);
        return true;
    }
    catch(error)
    {
        if(error instanceof BlobNotFoundError) { return false; }
        throw error;
    }
}

//----------------------------------------------------------------------------------------------------------------------
// State readers
//----------------------------------------------------------------------------------------------------------------------

interface FileNodeRow
{
    id : string;
    owner_id : string;
}

export async function fileNodesForBlob(handle : DatabaseHandle, sha256 : string) : Promise<FileNodeRow[]>
{
    return handle.db
        .selectFrom('node')
        .select([ 'id', 'owner_id' ])
        .where('blob_id', '=', sha256)
        .where('type', '=', 'file')
        .execute();
}

export async function blobRowCount(handle : DatabaseHandle, sha256 : string) : Promise<number>
{
    const row = await handle.db
        .selectFrom('blob')
        .select((eb) => eb.fn.count('sha256').as('count'))
        .where('sha256', '=', sha256)
        .executeTakeFirstOrThrow();
    return Number(row.count);
}

// The GC graveyard marker for a blob: null when live, a timestamp once its last reference is gone.
export async function blobDeletedAt(handle : DatabaseHandle, sha256 : string) : Promise<Date | string | null>
{
    const row = await handle.db
        .selectFrom('blob')
        .select('deleted_at')
        .where('sha256', '=', sha256)
        .executeTakeFirstOrThrow();
    return row.deleted_at;
}

interface NodeContentRow
{
    blob_id : string | null;
    size : number | null;
    mime_type : string | null;
    trashed_at : Date | string | null;
    name : string;
    parent_id : string | null;
}

// The content-bearing columns of a node row, read straight from the store so a replace can be proven at the row level.
export async function nodeContentRow(handle : DatabaseHandle, id : string) : Promise<NodeContentRow>
{
    return handle.db
        .selectFrom('node')
        .select([ 'blob_id', 'size', 'mime_type', 'trashed_at', 'name', 'parent_id' ])
        .where('id', '=', id)
        .executeTakeFirstOrThrow();
}

// Grant a share directly on a node, so an editor/viewer test can act on a file shared to them without driving the
// whole share-management surface. The share resolver reads these rows verbatim.
export async function grantShare(
    handle : DatabaseHandle,
    nodeID : string,
    granteeID : string,
    role : 'viewer' | 'editor',
    createdBy : string
) : Promise<void>
{
    await handle.db
        .insertInto('share')
        .values({
            id: `share-${ nodeID }-${ granteeID }`,
            node_id: nodeID,
            grantee_user_id: granteeID,
            role,
            created_by: createdBy,
            created_at: new Date().toISOString(),
        })
        .execute();
}

//----------------------------------------------------------------------------------------------------------------------
