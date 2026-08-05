//----------------------------------------------------------------------------------------------------------------------
// Authed Download (GET /api/nodes/:id/download)
//
// Expectations: an authed download uses the same Range/ETag behavior as public links; viewer suffices to
// read/download (effective role is max of ownership and direct/inherited grants); and trashed nodes are hidden from
// every recipient. The endpoint is behind the session gate, and access is resolved by the REAL share-aware resolver
// the app ships -- grants here are real share rows minted over the real share route, so these cases fail if share
// resolution regresses. Disposition follows ?disposition=, defaulting to attachment.
//----------------------------------------------------------------------------------------------------------------------

import { createHash, randomBytes } from 'node:crypto';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

// Support
import {
    type BootedServeApp,
    type TestUser,
    type UploadedFile,
    bodyBytes,
    bootServeApp,
    createFolder,
    getDownload,
    makeUser,
    shareWith,
    trashNode,
    uploadFile,
} from './support.ts';

//----------------------------------------------------------------------------------------------------------------------

function sha256Hex(data : Buffer) : string
{
    return createHash('sha256')
        .update(data)
        .digest('hex');
}

//----------------------------------------------------------------------------------------------------------------------

let booted : BootedServeApp;
let owner : TestUser;
let stranger : TestUser;
let fixture : Buffer;
let uploaded : UploadedFile;

beforeEach(async () =>
{
    booted = await bootServeApp();
    owner = await makeUser(booted, 'owner@example.com');
    stranger = await makeUser(booted, 'stranger@example.com');
    fixture = randomBytes(300);
    uploaded = await uploadFile(booted, owner, fixture, { name: 'report.pdf', mimeType: 'application/pdf' });
});

afterEach(async () =>
{
    await booted.cleanup();
});

//----------------------------------------------------------------------------------------------------------------------

describe('GET /api/nodes/:id/download — access', () =>
{
    it('rejects an unauthenticated request with 401', async () =>
    {
        const res = await getDownload(booted, undefined, uploaded.node.id);

        expect(res.status).toBe(401);
    });

    it('reads as absent (404) for a caller the resolver gives no role', async () =>
    {
        const res = await getDownload(booted, stranger.cookie, uploaded.node.id);

        expect(res.status).toBe(404);
    });

    it('serves a recipient holding only a viewer share — viewer suffices to download', async () =>
    {
        await shareWith(booted, owner, uploaded.node.id, stranger.id, 'viewer');

        const res = await getDownload(booted, stranger.cookie, uploaded.node.id);
        const body = await bodyBytes(res);

        expect(res.status).toBe(200);
        expect(body.equals(fixture)).toBe(true);
    });

    it('serves a recipient whose viewer share is on an ANCESTOR folder (inherited grant)', async () =>
    {
        const folder = await createFolder(booted, owner, 'shared-folder');
        const inFolder = await uploadFile(booted, owner, fixture, { name: 'inner.pdf', parentID: folder.id });

        // The grant is on the folder; the file inside it inherits the role through the ancestor chain.
        await shareWith(booted, owner, folder.id, stranger.id, 'viewer');

        const res = await getDownload(booted, stranger.cookie, inFolder.node.id);

        expect(res.status).toBe(200);
        expect((await bodyBytes(res)).equals(fixture)).toBe(true);
    });

    it('serves 200 with the exact bytes and sha256 ETag to the owner', async () =>
    {
        const res = await getDownload(booted, owner.cookie, uploaded.node.id);
        const body = await bodyBytes(res);

        expect(res.status).toBe(200);
        expect(res.headers.get('content-length')).toBe('300');
        expect(res.headers.get('accept-ranges')).toBe('bytes');
        expect(res.headers.get('etag')).toBe(`"${ sha256Hex(fixture) }"`);
        expect(body.equals(fixture)).toBe(true);
    });
});

//----------------------------------------------------------------------------------------------------------------------
// Trashing hides a node from every recipient. setTrashed stamps the whole subtree, so trashing a shared
// folder must cut off its files' BYTES through this endpoint too -- otherwise a recipient keeps pulling content the
// owner has withdrawn. The owner keeps access to their own trash until it purges.
//----------------------------------------------------------------------------------------------------------------------

describe('GET /api/nodes/:id/download — trashed content', () =>
{
    it('refuses a share recipient the bytes of a trashed file (hides it from all recipients)', async () =>
    {
        await shareWith(booted, owner, uploaded.node.id, stranger.id, 'viewer');

        // Establish that the grant really does serve while the file is live, so the 404 below is the trashing.
        const beforeTrash = await getDownload(booted, stranger.cookie, uploaded.node.id);
        expect(beforeTrash.status).toBe(200);

        const trashed = await trashNode(booted, owner, uploaded.node.id);
        expect(trashed.status).toBe(200);

        const res = await getDownload(booted, stranger.cookie, uploaded.node.id);

        expect(res.status).toBe(404);
    });

    // The scenario this is actually about: the owner withdraws a whole shared folder. The recipient's grant is still
    // live and still resolves, so only the trashed guard stops the bytes.
    it('refuses a recipient the bytes of a file inside a shared folder the owner trashed', async () =>
    {
        const folder = await createFolder(booted, owner, 'shared-folder');
        const inFolder = await uploadFile(booted, owner, fixture, { name: 'inner.pdf', parentID: folder.id });
        await shareWith(booted, owner, folder.id, stranger.id, 'viewer');
        expect(inFolder.node.parentID).toBe(folder.id);

        // Establish that the grant really does serve while the folder is live, so the 404 below is the trashing.
        const beforeTrash = await getDownload(booted, stranger.cookie, inFolder.node.id);
        expect(beforeTrash.status).toBe(200);

        // Trashing the FOLDER stamps the subtree, so the file inside it is trashed without being named directly.
        const trashed = await trashNode(booted, owner, folder.id);
        expect(trashed.status).toBe(200);

        const res = await getDownload(booted, stranger.cookie, inFolder.node.id);

        expect(res.status).toBe(404);
    });

    it('still serves the owner their own trashed file (their trash is theirs until it purges)', async () =>
    {
        const trashed = await trashNode(booted, owner, uploaded.node.id);
        expect(trashed.status).toBe(200);

        const res = await getDownload(booted, owner.cookie, uploaded.node.id);
        const body = await bodyBytes(res);

        expect(res.status).toBe(200);
        expect(body.equals(fixture)).toBe(true);
    });
});

//----------------------------------------------------------------------------------------------------------------------

describe('GET /api/nodes/:id/download — disposition', () =>
{
    it('defaults to attachment (forced download)', async () =>
    {
        const res = await getDownload(booted, owner.cookie, uploaded.node.id);

        expect(res.headers.get('content-disposition')?.startsWith('attachment')).toBe(true);
    });

    it('serves inline when ?disposition=inline (browser preview)', async () =>
    {
        const res = await getDownload(booted, owner.cookie, uploaded.node.id, { disposition: 'inline' });

        expect(res.headers.get('content-disposition')?.startsWith('inline')).toBe(true);
    });

    it('names the file in a quoted filename param', async () =>
    {
        const res = await getDownload(booted, owner.cookie, uploaded.node.id);

        expect(res.headers.get('content-disposition')).toBe('attachment; filename="report.pdf"');
    });

    // A quote or backslash in a name must not terminate the quoted-string early and let the rest of the name be read
    // as further parameters.
    it('cannot be broken out of by a name containing a quote', async () =>
    {
        const evil = await uploadFile(booted, owner, fixture, { name: 'sneaky".pdf' });

        const res = await getDownload(booted, owner.cookie, evil.node.id);
        const header = res.headers.get('content-disposition') ?? '';

        // Anchored, with no interior quote permitted: this only matches if the whole name stayed inside the string.
        expect(header).toMatch(/^attachment; filename="[^"\\]*"$/);
    });
});

//----------------------------------------------------------------------------------------------------------------------
// A non-ASCII name can't ride the quoted filename param, so RFC 5987/6266 asks for both: an ASCII-safe fallback for
// clients that only read `filename`, and `filename*` carrying the real name as percent-encoded UTF-8.
//----------------------------------------------------------------------------------------------------------------------

describe('GET /api/nodes/:id/download — non-ASCII filenames', () =>
{
    it('carries the real name as RFC 5987 percent-encoded UTF-8 in filename*', async () =>
    {
        // é is U+00E9 (UTF-8 C3 A9) and δ is U+03B4 (UTF-8 CE B4); '-' and '.' are unreserved and stay literal.
        const named = await uploadFile(booted, owner, fixture, { name: 'résumé-δ.pdf' });

        const res = await getDownload(booted, owner.cookie, named.node.id);

        expect(res.headers.get('content-disposition'))
            .toContain('filename*=UTF-8\'\'r%C3%A9sum%C3%A9-%CE%B4.pdf');
    });

    it('pairs it with a fallback filename holding no non-ASCII bytes', async () =>
    {
        const named = await uploadFile(booted, owner, fixture, { name: 'résumé-δ.pdf' });

        const res = await getDownload(booted, owner.cookie, named.node.id);
        const fallback = /filename="([^"]*)"/.exec(res.headers.get('content-disposition') ?? '')?.[1];

        expect(fallback).toBeDefined();
        expect(fallback).toMatch(/^[\x20-\x7e]*$/);
    });

    it('still applies the caller\'s disposition choice to a non-ASCII name', async () =>
    {
        const named = await uploadFile(booted, owner, fixture, { name: 'résumé-δ.pdf' });

        const res = await getDownload(booted, owner.cookie, named.node.id, { disposition: 'inline' });

        expect(res.headers.get('content-disposition')?.startsWith('inline')).toBe(true);
    });
});

//----------------------------------------------------------------------------------------------------------------------
// disposition is a presentation choice, not a capability. These ask for `inline`, the value that differs from the
// default: a caller refused the bytes must not get them by asking to preview instead of to save.
//----------------------------------------------------------------------------------------------------------------------

describe('GET /api/nodes/:id/download — disposition never widens access', () =>
{
    it('still rejects an unauthenticated request with 401', async () =>
    {
        const res = await getDownload(booted, undefined, uploaded.node.id, { disposition: 'inline' });

        expect(res.status).toBe(401);
    });

    it('still reads as absent (404) for a caller the resolver gives no role', async () =>
    {
        const res = await getDownload(booted, stranger.cookie, uploaded.node.id, { disposition: 'inline' });

        expect(res.status).toBe(404);
    });

    it('still refuses a share recipient the bytes of a trashed file', async () =>
    {
        await shareWith(booted, owner, uploaded.node.id, stranger.id, 'viewer');
        await trashNode(booted, owner, uploaded.node.id);

        const res = await getDownload(booted, stranger.cookie, uploaded.node.id, { disposition: 'inline' });

        expect(res.status).toBe(404);
    });

    it('refuses a folder on either disposition — only files have bytes', async () =>
    {
        const folder = await createFolder(booted, owner, 'not-downloadable');

        const attachment = await getDownload(booted, owner.cookie, folder.id, { disposition: 'attachment' });
        const inline = await getDownload(booted, owner.cookie, folder.id, { disposition: 'inline' });

        expect(attachment.status).toBe(404);
        expect(inline.status).toBe(404);
    });
});

//----------------------------------------------------------------------------------------------------------------------

describe('GET /api/nodes/:id/download — Range/ETag (same contract as public links)', () =>
{
    it('serves a byte range as 206 with exactly those bytes', async () =>
    {
        const res = await getDownload(booted, owner.cookie, uploaded.node.id, {}, { range: 'bytes=100-199' });
        const body = await bodyBytes(res);

        expect(res.status).toBe(206);
        expect(res.headers.get('content-range')).toBe('bytes 100-199/300');
        expect(res.headers.get('content-length')).toBe('100');
        expect(body.equals(fixture.subarray(100, 200))).toBe(true);
    });

    it('rejects an unsatisfiable range with 416', async () =>
    {
        const res = await getDownload(booted, owner.cookie, uploaded.node.id, {}, { range: 'bytes=500-999' });

        expect(res.status).toBe(416);
        expect(res.headers.get('content-range')).toBe('bytes */300');
    });

    it('returns a bodiless 304 when If-None-Match carries the current ETag', async () =>
    {
        const first = await getDownload(booted, owner.cookie, uploaded.node.id);
        const etag = first.headers.get('etag') ?? '';

        const res = await getDownload(booted, owner.cookie, uploaded.node.id, {}, { ifNoneMatch: etag });
        const body = await bodyBytes(res);

        expect(res.status).toBe(304);
        expect(body.length).toBe(0);
    });
});

//----------------------------------------------------------------------------------------------------------------------
