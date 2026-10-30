//----------------------------------------------------------------------------------------------------------------------
// Public Link / Download Spec Support
//
// Download authorization runs through the composed ShareRA-backed resolver, and grants are real share rows minted over
// the real share route. A hand-rolled resolver here would make every authorization assertion vacuous: it could not fail
// for a share-resolution regression, which is precisely what it must catch.
//----------------------------------------------------------------------------------------------------------------------

import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';

import { createId } from '@paralleldrive/cuid2';

import type { ClaimResponse, NodeResponse, ShareRole } from '@fileshed/core';

// Resource Access
import { NodeRA } from '@server/resource-access/nodes/index.ts';

// Support
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
}

export async function makeUser(booted : BootedStoreApp, email : string) : Promise<TestUser>
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
    booted : BootedStoreApp,
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
export async function forceMimeType(booted : BootedStoreApp, nodeID : string, mimeType : string) : Promise<void>
{
    await booted.handle.db
        .updateTable('node')
        // eslint-disable-next-line camelcase -- a snake_case DB column (house convention)
        .set({ mime_type: mimeType })
        .where('id', '=', nodeID)
        .execute();
}

export async function createFolder(
    booted : BootedStoreApp,
    user : TestUser,
    name = 'folder',
    parentID : string | null = null
) : Promise<NodeResponse>
{
    const res = await booted.app.request(`${ ORIGIN }/api/nodes`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'cookie': user.cookie },
        body: JSON.stringify({ type: 'folder', name, parentID }),
    });
    return res.json() as Promise<NodeResponse>;
}

// A LINK NODE -- a placement in the caller's own tree pointing at a node that may well be somebody else's, which is
// what makes a link worth having and what makes its access a question about the target. Not to be confused with
// createLink below, which mints a public link.
export async function createNodeLink(
    booted : BootedStoreApp,
    user : TestUser,
    targetNodeID : string,
    parentID : string | null = null,
    name ?: string
) : Promise<NodeResponse>
{
    const res = await booted.app.request(`${ ORIGIN }/api/nodes`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'cookie': user.cookie },
        body: JSON.stringify({ type: 'link', targetNodeID, parentID, ...name === undefined ? {} : { name } }),
    });

    return res.json() as Promise<NodeResponse>;
}

export async function trashNode(booted : BootedStoreApp, user : TestUser, nodeID : string) : Promise<Response>
{
    return booted.app.request(`${ ORIGIN }/api/nodes/${ nodeID }/trash`, {
        method: 'POST',
        headers: { cookie: user.cookie },
    });
}

// A REAL share grant, minted by the owner over the real share route -- the grant the real resolver reads back when it
// authorizes a download. Nothing here fakes a role.
export async function shareWith(
    booted : BootedStoreApp,
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

export async function seedEmptyFile(booted : BootedStoreApp, user : TestUser, name = 'empty.bin') : Promise<string>
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
        created: now,
        updated: now,
        trashedAt: null,
    });

    return id;
}

//----------------------------------------------------------------------------------------------------------------------
// Link management
//----------------------------------------------------------------------------------------------------------------------

// Minting takes no body: a link has nothing to configure. `body`, when a spec passes one, is what that spec is about --
// proving the endpoint gives it no meaning.
export async function createLink(
    booted : BootedStoreApp,
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

export async function listLinks(booted : BootedStoreApp, user : TestUser, nodeID : string) : Promise<Response>
{
    return booted.app.request(`${ ORIGIN }/api/nodes/${ nodeID }/links`, {
        headers: { cookie: user.cookie },
    });
}

export async function revokeLink(booted : BootedStoreApp, user : TestUser, linkID : string) : Promise<Response>
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
export async function getDirect(
    booted : BootedStoreApp,
    token : string,
    extra : ServeHeaders = {},
    query = ''
) : Promise<Response>
{
    return booted.app.request(`${ ORIGIN }/d/${ token }${ query }`, { headers: serveHeaders(extra) });
}

export async function getDownload(
    booted : BootedStoreApp,
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
