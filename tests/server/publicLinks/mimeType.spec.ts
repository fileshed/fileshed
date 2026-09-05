//----------------------------------------------------------------------------------------------------------------------
// Mime Types And Byte Serving
//
// A file node's mime type is written verbatim into the Content-Type header of every download of it, so a value a
// header cannot carry makes the node's own bytes un-servable -- to its owner and to every public link on it. Two
// expectations follow, and both are needed: no request may store such a value, and a node that already carries one
// still serves its bytes.
//
// The second is what makes the first repairable. A commit is an editor's authority, PATCH /api/nodes/:id renames and
// moves and nothing else, and the bytes have already been overwritten -- so without it, an owner whose node was
// bricked has no way back.
//----------------------------------------------------------------------------------------------------------------------

import { createHash, randomBytes } from 'node:crypto';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { FALLBACK_MIME_TYPE } from '@fileshed/core';

// Support
import {
    type BootedServeApp,
    ORIGIN,
    type TestUser,
    type UploadedFile,
    bodyBytes,
    bootServeApp,
    createLink,
    forceMimeType,
    getDirect,
    getDownload,
    makeUser,
    shareWith,
    uploadFile,
} from './support.ts';

//----------------------------------------------------------------------------------------------------------------------

// Every one of these makes a Node response un-emittable: CR and LF terminate a header, DEL is outside the field-value
// grammar, and an emoji is above Latin-1, which is all a header value can encode.
const UNSERVABLE = [ 'text/plain\r\nX-Injected: 1', 'text/plain\n', 'text/plain\x7f', 'audio/mpeg🎵' ];

function sha256Hex(data : Buffer) : string
{
    return createHash('sha256')
        .update(data)
        .digest('hex');
}

let booted : BootedServeApp;
let owner : TestUser;
let editor : TestUser;
let fixture : Buffer;
let uploaded : UploadedFile;

beforeEach(async () =>
{
    booted = await bootServeApp();
    owner = await makeUser(booted, 'owner@example.com');
    editor = await makeUser(booted, 'editor@example.com');
    fixture = randomBytes(256);
    uploaded = await uploadFile(booted, owner, fixture, { name: 'report.pdf', mimeType: 'application/pdf' });
});

afterEach(async () =>
{
    await booted.cleanup();
});

//----------------------------------------------------------------------------------------------------------------------

describe('storing a mime type', () =>
{
    it('refuses an upload declaring a mime type a response header could not carry', async () =>
    {
        const attempts = await Promise.all(UNSERVABLE.map(async (mimeType, index) =>
        {
            const body = Buffer.from(`payload ${ index }`);
            const claim = await booted.app.request(`${ ORIGIN }/api/blobs/claim`, {
                method: 'POST',
                headers: { 'content-type': 'application/json', 'cookie': owner.cookie },
                body: JSON.stringify({ sha256: sha256Hex(body), size: body.length }),
            });
            const ticket = (await claim.json() as { ticket : string }).ticket;
            const params = new URLSearchParams({ name: 'x.bin', mimeType });

            const res = await booted.app.request(`${ ORIGIN }/api/uploads/${ ticket }?${ params.toString() }`, {
                method: 'PUT',
                headers: { cookie: owner.cookie },
                body: new Uint8Array(body),
            });

            return res.status;
        }));

        expect(attempts).toEqual(UNSERVABLE.map(() => 400));
    });

    // The replace mode is the sharp one: replacing content is an editor's authority, so this is the request that lets
    // a stranger brick a node the owner owns.
    it('refuses an editor replacing content with a mime type a response header could not carry', async () =>
    {
        await shareWith(booted, owner, uploaded.node.id, editor.id, 'editor');

        const replacement = randomBytes(128);
        const claim = await booted.app.request(`${ ORIGIN }/api/blobs/claim`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'cookie': editor.cookie },
            body: JSON.stringify({ sha256: 'c'.repeat(64), size: replacement.length }),
        });
        const ticket = (await claim.json() as { ticket : string }).ticket;
        const params = new URLSearchParams({ replaceNodeID: uploaded.node.id, mimeType: 'application/pdf\r\n' });

        const res = await booted.app.request(`${ ORIGIN }/api/uploads/${ ticket }?${ params.toString() }`, {
            method: 'PUT',
            headers: { cookie: editor.cookie },
            body: new Uint8Array(replacement),
        });

        expect(res.status).toBe(400);

        // The refusal must leave the node as it was, not half-replaced under a type nothing can serve.
        const download = await getDownload(booted, owner.cookie, uploaded.node.id);
        expect(download.status).toBe(200);
        expect(download.headers.get('content-type')).toBe('application/pdf');
    });
});

//----------------------------------------------------------------------------------------------------------------------

describe('serving a node whose stored mime type is unservable', () =>
{
    it('serves the owner their own bytes under the generic binary type', async () =>
    {
        await forceMimeType(booted, uploaded.node.id, 'audio/mpeg🎵');

        const res = await getDownload(booted, owner.cookie, uploaded.node.id);

        expect(res.status).toBe(200);
        expect(res.headers.get('content-type')).toBe(FALLBACK_MIME_TYPE);
        expect(await bodyBytes(res)).toEqual(fixture);
    });

    // Two rules compose here, and the order is what makes the answer. The stored type is unservable, so it becomes
    // the generic binary type -- and a link renders in place, where nothing but a photo, a track, a clip or a document
    // is rendered as itself, so generic binary is handed over as text. What matters is that the link serves at all.
    it('serves a public link on it rather than failing for everybody', async () =>
    {
        const link = await (await createLink(booted, owner, uploaded.node.id)).json() as { token : string };
        await forceMimeType(booted, uploaded.node.id, 'text/plain\r\nX-Injected: 1');

        const res = await getDirect(booted, link.token);

        expect(res.status).toBe(200);
        expect(res.headers.get('content-type') ?? '').toMatch(/^text\/plain/);
        expect(res.headers.get('x-injected')).toBeNull();
        expect(await bodyBytes(res)).toEqual(fixture);
    });

    it('serves a range request off it too', async () =>
    {
        await forceMimeType(booted, uploaded.node.id, 'text/plain\x7f');

        const res = await getDownload(booted, owner.cookie, uploaded.node.id, {}, { range: 'bytes=0-15' });

        expect(res.status).toBe(206);
        expect(res.headers.get('content-type')).toBe(FALLBACK_MIME_TYPE);
        expect(await bodyBytes(res)).toEqual(fixture.subarray(0, 16));
    });

    // A servable type is passed through untouched; the fallback is for values that cannot be written, not a
    // normalisation of every stored type.
    it('leaves a servable type alone', async () =>
    {
        await forceMimeType(booted, uploaded.node.id, 'text/plain; charset=utf-8');

        const res = await getDownload(booted, owner.cookie, uploaded.node.id);

        expect(res.headers.get('content-type')).toBe('text/plain; charset=utf-8');
    });
});

//----------------------------------------------------------------------------------------------------------------------
