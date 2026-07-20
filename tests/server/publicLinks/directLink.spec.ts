//----------------------------------------------------------------------------------------------------------------------
// Direct Link Serving (GET /d/:token) — the byte-serving contract, over real streamed bytes
//
// Direct links serve bytes with Range, ETag, If-None-Match, Accept-Ranges, Content-Length, and inline vs attachment
// disposition; a link is revocable and needs no auth, and a trashed node is hidden from everyone. Streamed windows are
// compared byte-for-byte against the fixture buffer -- the point of the endpoint is the exact bytes, not just a status
// code.
//----------------------------------------------------------------------------------------------------------------------

import { createHash, randomBytes } from 'node:crypto';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { PublicLinkResponse } from '@fileshed/core';

// Support
import {
    type BootedServeApp,
    type TestUser,
    type UploadedFile,
    bodyBytes,
    bootServeApp,
    createLink,
    getDirect,
    makeUser,
    revokeLink,
    seedEmptyFile,
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
let fixture : Buffer;
let uploaded : UploadedFile;

beforeEach(async () =>
{
    booted = await bootServeApp();
    owner = await makeUser(booted, 'owner@example.com');
    fixture = randomBytes(300);
    uploaded = await uploadFile(booted, owner, fixture, { name: 'report.pdf', mimeType: 'application/pdf' });
});

afterEach(async () =>
{
    await booted.cleanup();
});

//----------------------------------------------------------------------------------------------------------------------

async function mintLink(disposition : 'inline' | 'attachment' = 'attachment') : Promise<PublicLinkResponse>
{
    const res = await createLink(booted, owner, uploaded.node.id, { disposition });
    expect(res.status).toBe(201);
    return res.json() as Promise<PublicLinkResponse>;
}

//----------------------------------------------------------------------------------------------------------------------

describe('GET /d/:token — full response', () =>
{
    it('serves 200 with the exact bytes, sha256 ETag, correct Content-Length, and Accept-Ranges', async () =>
    {
        const link = await mintLink();

        const res = await getDirect(booted, link.token);
        const body = await bodyBytes(res);

        expect(res.status).toBe(200);
        expect(res.headers.get('content-length')).toBe('300');
        expect(res.headers.get('accept-ranges')).toBe('bytes');
        // The blob sha256 is the natural (strong) etag, and it is the file node's blob id.
        expect(res.headers.get('etag')).toBe(`"${ sha256Hex(fixture) }"`);
        expect(sha256Hex(fixture)).toBe(uploaded.node.blobID);
        expect(res.headers.get('content-type')).toBe('application/pdf');
        expect(body.equals(fixture)).toBe(true);
    });

    it('serves the content with no session cookie — /d/:token is anonymous by design', async () =>
    {
        const link = await mintLink();

        // getDirect never sends a cookie; a 200 here proves no auth gate stands in front of the token.
        const res = await getDirect(booted, link.token);

        expect(res.status).toBe(200);
        expect((await bodyBytes(res)).equals(fixture)).toBe(true);
    });
});

//----------------------------------------------------------------------------------------------------------------------

describe('GET /d/:token — Range requests', () =>
{
    it('serves a closed range as 206 with exactly those bytes and a Content-Range', async () =>
    {
        const link = await mintLink();

        const res = await getDirect(booted, link.token, { range: 'bytes=100-199' });
        const body = await bodyBytes(res);

        expect(res.status).toBe(206);
        expect(res.headers.get('content-range')).toBe('bytes 100-199/300');
        expect(res.headers.get('content-length')).toBe('100');
        expect(res.headers.get('accept-ranges')).toBe('bytes');
        expect(body.equals(fixture.subarray(100, 200))).toBe(true);
    });

    it('serves an open-ended range (start-) to the end of the blob', async () =>
    {
        const link = await mintLink();

        const res = await getDirect(booted, link.token, { range: 'bytes=250-' });
        const body = await bodyBytes(res);

        expect(res.status).toBe(206);
        expect(res.headers.get('content-range')).toBe('bytes 250-299/300');
        expect(res.headers.get('content-length')).toBe('50');
        expect(body.equals(fixture.subarray(250, 300))).toBe(true);
    });

    it('serves a suffix range (-N) as the final N bytes', async () =>
    {
        const link = await mintLink();

        const res = await getDirect(booted, link.token, { range: 'bytes=-50' });
        const body = await bodyBytes(res);

        expect(res.status).toBe(206);
        expect(res.headers.get('content-range')).toBe('bytes 250-299/300');
        expect(res.headers.get('content-length')).toBe('50');
        expect(body.equals(fixture.subarray(250, 300))).toBe(true);
    });

    it('rejects an unsatisfiable range with 416 and Content-Range bytes */size', async () =>
    {
        const link = await mintLink();

        const res = await getDirect(booted, link.token, { range: 'bytes=500-999' });
        const body = await bodyBytes(res);

        expect(res.status).toBe(416);
        expect(res.headers.get('content-range')).toBe('bytes */300');
        expect(body.length).toBe(0);
    });

    // RFC 7233: a last-byte-pos below first-byte-pos makes the byte-range-spec INVALID, and an invalid Range
    // header must be IGNORED -- not answered with 416, which is reserved for a valid-but-unsatisfiable range.
    it('ignores an inverted range (end < start) and serves the full body', async () =>
    {
        const link = await mintLink();

        const res = await getDirect(booted, link.token, { range: 'bytes=5-3' });
        const body = await bodyBytes(res);

        expect(res.status).toBe(200);
        expect(res.headers.get('content-length')).toBe('300');
        expect(body.equals(fixture)).toBe(true);
    });

    // A single range is sufficient; a multi-range set is answered with the full body rather than
    // multipart/byteranges. Documented choice: full 200 is always a valid response to any range request.
    it('answers a multi-range request with the full body (200)', async () =>
    {
        const link = await mintLink();

        const res = await getDirect(booted, link.token, { range: 'bytes=0-9,20-29' });
        const body = await bodyBytes(res);

        expect(res.status).toBe(200);
        expect(res.headers.get('content-length')).toBe('300');
        expect(body.equals(fixture)).toBe(true);
    });
});

//----------------------------------------------------------------------------------------------------------------------
// A zero-byte blob has no satisfiable window at all, so every range against it is unsatisfiable. The suffix form is the
// one that can silently produce a zero-width window and emit a malformed Content-Range ("bytes 0--1/0") if unguarded.
//----------------------------------------------------------------------------------------------------------------------

describe('GET /d/:token — empty file', () =>
{
    it('rejects a suffix range against a zero-byte file with 416, never a malformed Content-Range', async () =>
    {
        const emptyID = await seedEmptyFile(booted, owner);
        const link = await (await createLink(booted, owner, emptyID, { disposition: 'attachment' }))
            .json() as PublicLinkResponse;

        const res = await getDirect(booted, link.token, { range: 'bytes=-5' });

        expect(res.status).toBe(416);
        expect(res.headers.get('content-range')).toBe('bytes */0');
    });

    it('rejects an open-ended range against a zero-byte file with 416', async () =>
    {
        const emptyID = await seedEmptyFile(booted, owner);
        const link = await (await createLink(booted, owner, emptyID, { disposition: 'attachment' }))
            .json() as PublicLinkResponse;

        const res = await getDirect(booted, link.token, { range: 'bytes=0-' });

        expect(res.status).toBe(416);
        expect(res.headers.get('content-range')).toBe('bytes */0');
    });

    it('serves the zero-byte file itself as an empty 200', async () =>
    {
        const emptyID = await seedEmptyFile(booted, owner);
        const link = await (await createLink(booted, owner, emptyID, { disposition: 'attachment' }))
            .json() as PublicLinkResponse;

        const res = await getDirect(booted, link.token);

        expect(res.status).toBe(200);
        expect(res.headers.get('content-length')).toBe('0');
        expect((await bodyBytes(res)).length).toBe(0);
    });
});

//----------------------------------------------------------------------------------------------------------------------

describe('GET /d/:token — conditional request', () =>
{
    it('returns a bodiless 304 when If-None-Match carries the current ETag', async () =>
    {
        const link = await mintLink();

        const first = await getDirect(booted, link.token);
        const etag = first.headers.get('etag');
        expect(etag).not.toBeNull();

        const res = await getDirect(booted, link.token, { ifNoneMatch: etag ?? '' });
        const body = await bodyBytes(res);

        expect(res.status).toBe(304);
        expect(body.length).toBe(0);
    });
});

//----------------------------------------------------------------------------------------------------------------------

describe('GET /d/:token — disposition', () =>
{
    it('sets Content-Disposition: inline for an inline (hotlink) link', async () =>
    {
        const link = await mintLink('inline');

        const res = await getDirect(booted, link.token);

        expect(res.headers.get('content-disposition')?.startsWith('inline')).toBe(true);
        expect(res.headers.get('content-disposition')).not.toContain('attachment');
    });

    it('sets Content-Disposition: attachment for a forced-download link', async () =>
    {
        const link = await mintLink('attachment');

        const res = await getDirect(booted, link.token);

        expect(res.headers.get('content-disposition')?.startsWith('attachment')).toBe(true);
    });

    it('encodes a non-ASCII filename with an RFC 5987 filename* plus an ASCII fallback', async () =>
    {
        const named = await uploadFile(booted, owner, fixture, { name: 'résumé.pdf', mimeType: 'application/pdf' });
        const res = await createLink(booted, owner, named.node.id, { disposition: 'attachment' });
        const link = await res.json() as PublicLinkResponse;

        const served = await getDirect(booted, link.token);
        const disposition = served.headers.get('content-disposition') ?? '';

        // The real UTF-8 name rides filename* percent-encoded; the quoted filename is a sanitized ASCII fallback.
        expect(disposition).toContain(`filename*=UTF-8''${ encodeURIComponent('résumé.pdf') }`);
        expect(disposition).toMatch(/filename="[\x20-\x7e]+"/);
    });
});

//----------------------------------------------------------------------------------------------------------------------

describe('GET /d/:token — dead links serve nothing', () =>
{
    it('returns 404 for an unknown token', async () =>
    {
        const res = await getDirect(booted, 'this-token-was-never-minted');

        expect(res.status).toBe(404);
    });

    it('returns 404 once the link is revoked (a revoked link is dead)', async () =>
    {
        const link = await mintLink();

        const revoked = await revokeLink(booted, owner, link.id);
        expect(revoked.status).toBe(204);

        const res = await getDirect(booted, link.token);

        expect(res.status).toBe(404);
    });

    it('returns 404 when the target file is trashed (trashed nodes are hidden from everyone)', async () =>
    {
        const link = await mintLink();

        const trashed = await trashNode(booted, owner, uploaded.node.id);
        expect(trashed.status).toBe(200);

        const res = await getDirect(booted, link.token);

        expect(res.status).toBe(404);
    });
});

//----------------------------------------------------------------------------------------------------------------------
