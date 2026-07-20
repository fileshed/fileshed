//----------------------------------------------------------------------------------------------------------------------
// Public Link Management (POST/GET /api/nodes/:id/links, DELETE /api/links/:id)
//
// Expectations: links reference file nodes, are revocable, and allow multiple per node; sharing is the owner's
// authority. A folder has no bytes, so a link on one is refused; only the owner may create, list, or revoke a
// node's links.
//----------------------------------------------------------------------------------------------------------------------

import { randomBytes } from 'node:crypto';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { PUBLIC_LINK_TOKEN_BYTES, type PublicLinkListResponse, type PublicLinkResponse } from '@fileshed/core';

// Support
import {
    type BootedServeApp,
    ORIGIN,
    type TestUser,
    type UploadedFile,
    bootServeApp,
    createFolder,
    createLink,
    listLinks,
    makeUser,
    revokeLink,
    uploadFile,
} from './support.ts';

//----------------------------------------------------------------------------------------------------------------------

let booted : BootedServeApp;
let owner : TestUser;
let stranger : TestUser;
let uploaded : UploadedFile;

beforeEach(async () =>
{
    booted = await bootServeApp();
    owner = await makeUser(booted, 'owner@example.com');
    stranger = await makeUser(booted, 'stranger@example.com');
    uploaded = await uploadFile(booted, owner, randomBytes(64), { name: 'report.pdf', mimeType: 'application/pdf' });
});

afterEach(async () =>
{
    await booted.cleanup();
});

//----------------------------------------------------------------------------------------------------------------------

describe('POST /api/nodes/:id/links', () =>
{
    it('mints a link on a file node and returns the token plus its /d/:token URL', async () =>
    {
        const res = await createLink(booted, owner, uploaded.node.id, { mode: 'view', disposition: 'inline' });
        const link = await res.json() as PublicLinkResponse;

        expect(res.status).toBe(201);
        expect(link.nodeID).toBe(uploaded.node.id);
        expect(link.mode).toBe('view');
        expect(link.disposition).toBe('inline');
        // Token entropy >= 128 bits. base64url packs 6 bits per character, so the encoded token must be at
        // least ceil(bytes * 8 / 6) characters long -- an assertion that fails if the token width is ever narrowed.
        expect(PUBLIC_LINK_TOKEN_BYTES * 8).toBeGreaterThanOrEqual(128);
        expect(link.token.length).toBeGreaterThanOrEqual(Math.ceil((PUBLIC_LINK_TOKEN_BYTES * 8) / 6));
        expect(link.url).toBe(`/d/${ link.token }`);
        expect(link.revokedAt).toBeNull();
    });

    it('allows multiple distinct links on one node (e.g. one inline, one download)', async () =>
    {
        const inline = await (await createLink(booted, owner, uploaded.node.id, { disposition: 'inline' }))
            .json() as PublicLinkResponse;
        const download = await (await createLink(booted, owner, uploaded.node.id, { disposition: 'attachment' }))
            .json() as PublicLinkResponse;

        expect(inline.token).not.toBe(download.token);

        const list = await (await listLinks(booted, owner, uploaded.node.id)).json() as PublicLinkListResponse;
        expect(list.links.map((entry) => entry.id).sort()).toEqual([ inline.id, download.id ].sort());
    });

    // Both toggles are optional; an empty JSON object takes the documented safe pair (forced download) rather than
    // guessing at a hotlink.
    it('defaults an unspecified link to the download/attachment pair', async () =>
    {
        const res = await createLink(booted, owner, uploaded.node.id, {});
        const link = await res.json() as PublicLinkResponse;

        expect(res.status).toBe(201);
        expect(link.mode).toBe('download');
        expect(link.disposition).toBe('attachment');
    });

    it('refuses a link on a folder node (public links reference file nodes)', async () =>
    {
        const folder = await createFolder(booted, owner, 'shared');

        const res = await createLink(booted, owner, folder.id, { disposition: 'attachment' });

        expect(res.status).toBe(400);
    });

    it('refuses a non-owner minting a link (sharing is the owner\'s authority)', async () =>
    {
        const res = await createLink(booted, stranger, uploaded.node.id, { disposition: 'attachment' });

        expect(res.status).toBe(403);
    });

    it('rejects an unauthenticated request with 401', async () =>
    {
        const res = await booted.app.request(`${ ORIGIN }/api/nodes/${ uploaded.node.id }/links`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ disposition: 'attachment' }),
        });

        expect(res.status).toBe(401);
    });
});

//----------------------------------------------------------------------------------------------------------------------

describe('GET /api/nodes/:id/links', () =>
{
    it('lists the node\'s links for the owner', async () =>
    {
        const created = await (await createLink(booted, owner, uploaded.node.id, { disposition: 'attachment' }))
            .json() as PublicLinkResponse;

        const list = await (await listLinks(booted, owner, uploaded.node.id)).json() as PublicLinkListResponse;

        expect(list.links).toHaveLength(1);
        expect(list.links[0]?.id).toBe(created.id);
    });

    it('refuses a non-owner listing a node\'s links', async () =>
    {
        await createLink(booted, owner, uploaded.node.id, { disposition: 'attachment' });

        const res = await listLinks(booted, stranger, uploaded.node.id);

        expect(res.status).toBe(403);
    });
});

//----------------------------------------------------------------------------------------------------------------------

describe('DELETE /api/links/:id', () =>
{
    it('revokes the owner\'s link and marks revokedAt on the listing', async () =>
    {
        const link = await (await createLink(booted, owner, uploaded.node.id, { disposition: 'attachment' }))
            .json() as PublicLinkResponse;

        const revoked = await revokeLink(booted, owner, link.id);
        expect(revoked.status).toBe(204);

        // A revoked link still lists (it is revoked, not deleted) with revokedAt set.
        const list = await (await listLinks(booted, owner, uploaded.node.id)).json() as PublicLinkListResponse;
        expect(list.links[0]?.revokedAt).not.toBeNull();
    });

    it('refuses a non-owner revoking a link', async () =>
    {
        const link = await (await createLink(booted, owner, uploaded.node.id, { disposition: 'attachment' }))
            .json() as PublicLinkResponse;

        const res = await revokeLink(booted, stranger, link.id);

        expect(res.status).toBe(403);
    });

    it('404s revoking a link that does not exist', async () =>
    {
        const res = await revokeLink(booted, owner, 'no-such-link-id');

        expect(res.status).toBe(404);
    });
});

//----------------------------------------------------------------------------------------------------------------------
