//----------------------------------------------------------------------------------------------------------------------
// Blob Flow Spec Support
//
// The claim/PoP/upload slice over the composed app (see support/storeApp.ts), with the upload tunables a spec can move
// between requests the way an admin patching the setting does. Specs drive the flow with app.request and read state
// through the real handle and storage RA, zero mocks.
//----------------------------------------------------------------------------------------------------------------------

/* eslint-disable camelcase -- reads/writes name snake_case DB columns (house convention for Kysely) */

import { createHmac } from 'node:crypto';
import type { Readable } from 'node:stream';

import type { Hono } from 'hono';

// Models
import { BlobNotFoundError, DEFAULT_SKIPPED_UPLOAD_NAMES, UNLIMITED_QUOTA, parseSkippedNames } from '@fileshed/core';

// Resource Access
import type { BlobLocation } from '@server/resource-access/blob/index.ts';
import type { DatabaseHandle } from '@server/resource-access/database/database.ts';

// Managers
import { BlobManager } from '@server/managers/blob.ts';

// App
import type { AppServices } from '@server/services.ts';

// Support
import { ORIGIN, cookieFrom, cookieJarFrom, signIn, signUp } from '../auth/support.ts';
import { type BootedStoreApp, type StoreParts, bootStoreApp } from '../support/storeApp.ts';

export { ORIGIN, cookieFrom, cookieJarFrom, signIn, signUp } from '../auth/support.ts';
export type { BootedStoreApp } from '../support/storeApp.ts';

//----------------------------------------------------------------------------------------------------------------------

export interface BlobAppOptions
{
    // The single-upload ceiling. A supplier, not a number, so a spec can move it between requests the way an admin
    // patching the setting does -- which is how a ticket outlives the cap it was issued under.
    uploadMaxBytes ?: () => Promise<number>;
    skippedUploadNames ?: () => Promise<string[]>;

    // The chunk size the instance hands out with a ticket, so a spec can drive an upload against a deployment that
    // tuned it rather than only against the compiled default.
    uploadChunkBytes ?: number;

    // The instance-wide quota an account with no limit of its own inherits, likewise a supplier.
    defaultQuota ?: () => Promise<number>;

    // Any other manager the spec swaps in, built over the same parts.
    services ?: (parts : StoreParts) => Partial<AppServices>;
}

export async function bootBlobApp(options : BlobAppOptions = {}) : Promise<BootedStoreApp>
{
    return bootStoreApp({
        config: options.uploadChunkBytes === undefined ? {} : { UPLOAD_CHUNK_BYTES: options.uploadChunkBytes },
        services: (parts) => ({
            blobs: new BlobManager({
                handle: parts.handle,
                blob: parts.blob,
                uploadMaxBytes: options.uploadMaxBytes ?? (async () => parts.config.UPLOAD_MAX_BYTES),
                skippedUploadNames: options.skippedUploadNames
                    ?? (async () => parseSkippedNames(DEFAULT_SKIPPED_UPLOAD_NAMES)),
                uploadChunkBytes: parts.config.UPLOAD_CHUNK_BYTES,
                defaultQuota: options.defaultQuota ?? (async () => UNLIMITED_QUOTA),
                responder: parts.composed.nodes,
                tags: parts.composed.mediaTags,
            }),
            ...options.services?.(parts),
        }),
    });
}

//----------------------------------------------------------------------------------------------------------------------
// A signed-in user: their id (as the FKs and quotas see it) and their session cookie.
//----------------------------------------------------------------------------------------------------------------------

export interface TestUser
{
    id : string;
    cookie : string;

    // Every cookie sign-in set, the way a browser carries them. With the session cookie cache off that is the token
    // alone, so a spec exercising a user row that changes after sign-in sends this to say the answer must come from
    // the row whatever the browser holds -- and to fail if a cached snapshot ever reappears.
    jar : string;
    email : string;
}

// Sign up with an optional starting quota_limit on the row, then sign in for a session cookie.
export async function makeUser(
    booted : BootedStoreApp,
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

    const signInRes = await signIn(booted.app, email, password);

    const row = await booted.handle.db.selectFrom('user').select('id')
        .where('email', '=', email)
        .executeTakeFirstOrThrow();

    return { id: row.id, cookie: cookieFrom(signInRes), jar: cookieJarFrom(signInRes), email };
}

// Move a user's cap after they are signed in, the way an admin patching the row does -- their session still carries
// whatever it was minted with, so a spec can drive a write judged by a limit the caller has never seen.
export async function setQuotaLimit(booted : BootedStoreApp, userID : string, quotaLimit : number) : Promise<void>
{
    await booted.handle.db
        .updateTable('user')
        .set({ quota_limit: quotaLimit })
        .where('id', '=', userID)
        .execute();
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

export async function claim(app : Hono, cookie : string, sha256 : string, size : number) : Promise<Response>
{
    return app.request(`${ ORIGIN }/api/blobs/claim`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify({ sha256, size }),
    });
}

export async function answerChallenge(
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

export async function putUpload(
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

// One chunk of an upload: the same PUT, with the offset saying where these bytes belong in the claimed file. The
// commit metadata rides every chunk, exactly as the client sends it, though only the chunk completing the file uses it.
export async function putChunk(
    app : Hono,
    cookie : string,
    ticket : string,
    bytes : Buffer,
    offset : number,
    metadata : CommitMetadata = defaultMetadata
) : Promise<Response>
{
    const params = new URLSearchParams({
        name: metadata.name,
        mimeType: metadata.mimeType,
        offset: String(offset),
    });
    if(metadata.parentID !== null) { params.set('parentID', metadata.parentID); }

    return app.request(`${ ORIGIN }/api/uploads/${ ticket }?${ params.toString() }`, {
        method: 'PUT',
        headers: { cookie },
        body: new Uint8Array(bytes),
    });
}

// The replace variant of a chunk: the final chunk of a replace names the target instead of a placement.
export async function putChunkReplace(
    app : Hono,
    cookie : string,
    ticket : string,
    bytes : Buffer,
    offset : number,
    replaceNodeID : string
) : Promise<Response>
{
    const params = new URLSearchParams({ replaceNodeID, offset: String(offset) });

    return app.request(`${ ORIGIN }/api/uploads/${ ticket }?${ params.toString() }`, {
        method: 'PUT',
        headers: { cookie },
        body: new Uint8Array(bytes),
    });
}

// The replace variant of the upload commit: replaceNodeID (and an optional overriding mimeType, and an optional
// ifBlobID concurrency guard) ride the query string instead of the create metadata, so a completed upload overwrites
// an existing file's content in place.
export async function putReplace(
    app : Hono,
    cookie : string,
    ticket : string,
    bytes : Buffer,
    replaceNodeID : string,
    mimeType ?: string,
    ifBlobID ?: string
) : Promise<Response>
{
    const params = new URLSearchParams({ replaceNodeID });
    if(mimeType !== undefined) { params.set('mimeType', mimeType); }
    if(ifBlobID !== undefined) { params.set('ifBlobID', ifBlobID); }

    return app.request(`${ ORIGIN }/api/uploads/${ ticket }?${ params.toString() }`, {
        method: 'PUT',
        headers: { cookie },
        body: new Uint8Array(bytes),
    });
}

// The replace variant of the proof-of-possession answer: the body carries replaceNodeID (and an optional mimeType, and
// an optional ifBlobID concurrency guard) instead of the create metadata, so a proven dedup overwrites an existing
// file's content with zero bytes moved.
export async function answerReplace(
    app : Hono,
    cookie : string,
    challengeID : string,
    answer : string,
    replaceNodeID : string,
    mimeType ?: string,
    ifBlobID ?: string
) : Promise<Response>
{
    const body : Record<string, string> = { answer, replaceNodeID };
    if(mimeType !== undefined) { body.mimeType = mimeType; }
    if(ifBlobID !== undefined) { body.ifBlobID = ifBlobID; }

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

function locationOf(booted : BootedStoreApp, sha256 : string) : BlobLocation
{
    return { backendID: booted.backendID, storageKey: sha256 };
}

async function collect(stream : Readable) : Promise<Buffer>
{
    const chunks : Buffer[] = [];
    for await (const chunk of stream) { chunks.push(chunk as Buffer); }
    return Buffer.concat(chunks);
}

export async function storedBytes(booted : BootedStoreApp, sha256 : string) : Promise<Buffer>
{
    return collect(await booted.blob.getStream(locationOf(booted, sha256)));
}

export async function bytesExist(booted : BootedStoreApp, sha256 : string) : Promise<boolean>
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
