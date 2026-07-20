//----------------------------------------------------------------------------------------------------------------------
// Save a copy — POST /api/nodes/:id/copy
//
// The HTTP contract of save-a-copy, driven end to end through the full stack (real auth, database, fs blob backend,
// upload flow, shares): a viewer of a shared file materializes their own owned copy charged to them, and the regulation
// rejections (non-file source, no access, cross-owner placement) reach the wire as the right statuses. The manager spec
// owns the exhaustive logic; this proves the route is wired and the mapping is correct.
//----------------------------------------------------------------------------------------------------------------------

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

// Support
import {
    type BootedShareApp,
    type TestUser,
    bootShareApp,
    createFolder,
    grantShare,
    makeUser,
    request,
    uploadSmallFile,
} from '../shares/support.ts';

//----------------------------------------------------------------------------------------------------------------------

type Json = Record<string, unknown>;

let booted : BootedShareApp;
let owner : TestUser;
let recipient : TestUser;

beforeEach(async () =>
{
    booted = await bootShareApp();
    owner = await makeUser(booted, 'owner@example.com');
    recipient = await makeUser(booted, 'recipient@example.com');
});

afterEach(async () =>
{
    await booted.cleanup();
});

// Upload a file owned by `owner` and share it to `grantee`, returning the shared file node.
async function shareFile(bytes : Buffer, grantee : TestUser, role : 'viewer' | 'editor' = 'viewer') : Promise<Json>
{
    const file = await (await uploadSmallFile(booted.app, owner.cookie, bytes, null, 'shared.bin')).json() as Json;
    await grantShare(booted.app, owner.cookie, file.id as string, grantee.id, role);

    return file;
}

async function usedBytes(user : TestUser) : Promise<number>
{
    const me = await (await request(booted.app, 'GET', '/api/me', user.cookie)).json() as { quota : { used : number } };
    return me.quota.used;
}

//----------------------------------------------------------------------------------------------------------------------

describe('POST /api/nodes/:id/copy', () =>
{
    it('lets a viewer save a copy of a shared file into their root, owned by and charged to them', async () =>
    {
        const bytes = Buffer.from('shared content');
        const file = await shareFile(bytes, recipient);

        const res = await request(
            booted.app, 
            'POST', 
            `/api/nodes/${ file.id }/copy`, 
            recipient.cookie,
            { parentID: null }
        );
        const body = await res.json() as Json;

        expect(res.status).toBe(201);
        expect(body).toMatchObject({
            type: 'file',
            ownerID: recipient.id,
            parentID: null,
            role: 'owner',
            blobID: file.blobID,
        });
        expect(body.id).not.toBe(file.id);

        // The copy is a distinct, independently-owned node charged to the recipient.
        expect(await usedBytes(recipient)).toBe(bytes.length);
    });

    it('honors an explicit copy name and defaults to the source name otherwise', async () =>
    {
        const file = await shareFile(Buffer.from('bytes'), recipient);

        const named = await (await request(
            booted.app, 
            'POST', 
            `/api/nodes/${ file.id }/copy`, 
            recipient.cookie,
            { parentID: null, name: 'my copy.bin' }
        )).json() as Json;
        const defaulted = await (await request(
            booted.app, 
            'POST', 
            `/api/nodes/${ file.id }/copy`, 
            recipient.cookie,
            { parentID: null }
        )).json() as Json;

        expect(named.name).toBe('my copy.bin');
        expect(defaulted.name).toBe(file.name);
    });

    it('rejects copying a folder with 422 sourceNotFile', async () =>
    {
        const folder = await createFolder(booted.app, owner.cookie, 'Docs');

        const res = await request(booted.app, 'POST', `/api/nodes/${ folder }/copy`, owner.cookie, { parentID: null });
        const body = await res.json() as { violations ?: { code : string }[] };

        expect(res.status).toBe(422);
        expect(body.violations?.map((violation) => violation.code)).toContain('copy.sourceNotFile');
    });

    it('returns 404 when the caller cannot resolve the source', async () =>
    {
        const uploaded = await uploadSmallFile(booted.app, owner.cookie, Buffer.from('private'), null);
        const file = await uploaded.json() as Json;

        const res = await request(
            booted.app, 
            'POST', 
            `/api/nodes/${ file.id }/copy`, 
            recipient.cookie,
            { parentID: null }
        );

        expect(res.status).toBe(404);
    });

    it('rejects copying into a folder the caller only views with 403 crossOwner', async () =>
    {
        const folder = await createFolder(booted.app, owner.cookie, 'Team');
        await grantShare(booted.app, owner.cookie, folder, recipient.id, 'viewer');
        const file = await shareFile(Buffer.from('shared content'), recipient);

        const res = await request(
            booted.app, 
            'POST', 
            `/api/nodes/${ file.id }/copy`, 
            recipient.cookie,
            { parentID: folder }
        );
        const body = await res.json() as { violations ?: { code : string }[] };

        expect(res.status).toBe(403);
        expect(body.violations?.map((violation) => violation.code)).toContain('parent.crossOwner');
    });

    it('rejects an unauthenticated copy with 401', async () =>
    {
        const res = await request(booted.app, 'POST', '/api/nodes/anything/copy', undefined, { parentID: null });

        expect(res.status).toBe(401);
    });
});

//----------------------------------------------------------------------------------------------------------------------
