//----------------------------------------------------------------------------------------------------------------------
// Direct Link Serving (GET /d/:token) — the byte-serving contract, over real streamed bytes
//
// Direct links serve bytes with Range, ETag, If-None-Match, Accept-Ranges and Content-Length; they render in place
// unless the URL asks for a download; and a link is revocable, needs no auth, and dies with a trashed node. Streamed
// windows are compared byte-for-byte against the fixture buffer -- the point of the endpoint is the exact bytes, not
// just a status code.
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

async function mintLink(nodeID = uploaded.node.id) : Promise<PublicLinkResponse>
{
    const res = await createLink(booted, owner, nodeID);
    expect(res.status).toBe(201);
    return res.json() as Promise<PublicLinkResponse>;
}

function dispositionOf(res : Response) : string
{
    return res.headers.get('content-disposition') ?? '';
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
        const link = await mintLink(emptyID);

        const res = await getDirect(booted, link.token, { range: 'bytes=-5' });

        expect(res.status).toBe(416);
        expect(res.headers.get('content-range')).toBe('bytes */0');
    });

    it('rejects an open-ended range against a zero-byte file with 416', async () =>
    {
        const emptyID = await seedEmptyFile(booted, owner);
        const link = await mintLink(emptyID);

        const res = await getDirect(booted, link.token, { range: 'bytes=0-' });

        expect(res.status).toBe(416);
        expect(res.headers.get('content-range')).toBe('bytes */0');
    });

    it('serves the zero-byte file itself as an empty 200', async () =>
    {
        const emptyID = await seedEmptyFile(booted, owner);
        const link = await mintLink(emptyID);

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
    it('renders the file in place by default — the address exists to be hotlinkable', async () =>
    {
        const link = await mintLink();

        const res = await getDirect(booted, link.token);

        expect(dispositionOf(res)).toMatch(/^inline/);
        expect(dispositionOf(res)).not.toContain('attachment');
    });

    it('serves the same token as an attachment when the URL says ?download', async () =>
    {
        const link = await mintLink();

        const res = await getDirect(booted, link.token, {}, '?download');

        expect(dispositionOf(res)).toMatch(/^attachment/);
        expect((await bodyBytes(res)).equals(fixture)).toBe(true);
    });

    // The flag is a flag: it is there or it is not, so the shortest thing anyone can append to a pasted URL works and
    // no one has to learn which value means yes.
    it('takes the flag\'s presence as the switch, whatever value it carries', async () =>
    {
        const link = await mintLink();

        expect(dispositionOf(await getDirect(booted, link.token, {}, '?download='))).toMatch(/^attachment/);
        expect(dispositionOf(await getDirect(booted, link.token, {}, '?download=0'))).toMatch(/^attachment/);
    });

    // The URL is the only thing that decides this. Minting cannot express a kind, so a body that names one buys
    // nothing: the link it creates still renders in place, and still saves under the flag.
    it('gives a create body naming a kind no effect on how the link serves', async () =>
    {
        const res = await createLink(booted, owner, uploaded.node.id, { mode: 'download', disposition: 'attachment' });
        const link = await res.json() as PublicLinkResponse;

        expect(res.status).toBe(201);
        expect(dispositionOf(await getDirect(booted, link.token))).toMatch(/^inline/);
        expect(dispositionOf(await getDirect(booted, link.token, {}, '?download'))).toMatch(/^attachment/);
    });

    it('serves every link on a node identically — no token carries a kind of its own', async () =>
    {
        const first = await mintLink();
        const second = await mintLink();

        expect(first.token).not.toBe(second.token);
        expect(dispositionOf(await getDirect(booted, first.token)))
            .toBe(dispositionOf(await getDirect(booted, second.token)));
    });

    it('encodes a non-ASCII filename with an RFC 5987 filename* plus an ASCII fallback', async () =>
    {
        const named = await uploadFile(booted, owner, fixture, { name: 'résumé.pdf', mimeType: 'application/pdf' });
        const link = await mintLink(named.node.id);

        const disposition = dispositionOf(await getDirect(booted, link.token, {}, '?download'));

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

    // Revocation kills the token, and both forms are the same token -- there is no second thing left to revoke.
    it('returns 404 for both forms once the link is revoked (a revoked link is dead)', async () =>
    {
        const link = await mintLink();

        const revoked = await revokeLink(booted, owner, link.id);
        expect(revoked.status).toBe(204);

        expect((await getDirect(booted, link.token)).status).toBe(404);
        expect((await getDirect(booted, link.token, {}, '?download')).status).toBe(404);
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
