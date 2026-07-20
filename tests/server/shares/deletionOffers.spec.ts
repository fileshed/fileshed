//----------------------------------------------------------------------------------------------------------------------
// Deletion Offers — HTTP lifecycle
//
// The recipients-may-copy flow over the real routes: a shared file is hard-deleted with the opt-in, the recipient
// finds the offer, and accepting materializes an owned copy from the graveyarded blob. Database state (offer rows,
// the blob's graveyard marker, node ownership) is asserted alongside every response.
//----------------------------------------------------------------------------------------------------------------------

import { randomBytes } from 'node:crypto';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { DeletionOfferListResponse, NodeResponse } from '@fileshed/core';

// Support
import {
    type BootedShareApp,
    type TestUser,
    bootShareApp,
    createFolder,
    grantShare,
    makeUser,
    request,
    sha256Of,
    uploadSmallFile,
} from './support.ts';

//----------------------------------------------------------------------------------------------------------------------

let booted : BootedShareApp;
let alice : TestUser;
let bob : TestUser;

const bytes = randomBytes(2048);

beforeEach(async () =>
{
    booted = await bootShareApp();
    alice = await makeUser(booted, 'alice@example.com');
    bob = await makeUser(booted, 'bob@example.com');
});

afterEach(async () =>
{
    await booted.cleanup();
});

//----------------------------------------------------------------------------------------------------------------------

// Alice shares a folder with bob, uploads a file into it, and hard-deletes the file with the opt-in. Returns the
// file's node id.
async function deleteSharedFileWithOffer() : Promise<string>
{
    const folderID = await createFolder(booted.app, alice.cookie, 'shared');
    await grantShare(booted.app, alice.cookie, folderID, bob.id, 'viewer');

    const upload = await uploadSmallFile(booted.app, alice.cookie, bytes, folderID, 'report.bin');
    const node = await upload.json() as NodeResponse;

    const res = await request(booted.app, 'DELETE', `/api/nodes/${ node.id }?offerCopies=true`, alice.cookie);
    expect(res.status).toBe(204);

    return node.id;
}

async function listOffers(cookie : string) : Promise<DeletionOfferListResponse>
{
    const res = await request(booted.app, 'GET', '/api/deletion-offers', cookie);
    expect(res.status).toBe(200);
    return await res.json() as DeletionOfferListResponse;
}

async function blobDeletedAt() : Promise<string | Date | null>
{
    const row = await booted.handle.db.selectFrom('blob').select('deleted_at')
        .where('sha256', '=', sha256Of(bytes))
        .executeTakeFirstOrThrow();
    return row.deleted_at;
}

//----------------------------------------------------------------------------------------------------------------------

describe('deletion offers over HTTP', () =>
{
    it('walks the full lifecycle: delete with opt-in, list, accept into an owned live copy', async () =>
    {
        await deleteSharedFileWithOffer();
        expect(await blobDeletedAt()).not.toBeNull();

        const listed = await listOffers(bob.cookie);
        expect(listed.offers).toHaveLength(1);
        const offer = listed.offers[0];
        if(offer === undefined) { throw new Error('expected an offer'); }
        expect(offer).toMatchObject({
            sha256: sha256Of(bytes),
            name: 'report.bin',
            size: bytes.length,
            createdBy: alice.id,
        });

        const acceptPath = `/api/deletion-offers/${ offer.id }/accept`;
        const acceptRes = await request(booted.app, 'POST', acceptPath, bob.cookie, { parentID: null });
        const node = await acceptRes.json() as NodeResponse;

        expect(acceptRes.status).toBe(201);
        expect(node).toMatchObject({ type: 'file', ownerID: bob.id, name: 'report.bin', role: 'owner' });

        // The copy references the original bytes, un-graveyarded, and the offer is consumed.
        expect(await blobDeletedAt()).toBeNull();
        expect((await listOffers(bob.cookie)).offers).toEqual([]);

        const retry = await request(booted.app, 'POST', acceptPath, bob.cookie, { parentID: null });
        expect(retry.status).toBe(404);
    });

    it('declines an offer without creating anything', async () =>
    {
        await deleteSharedFileWithOffer();
        const offer = (await listOffers(bob.cookie)).offers[0];
        if(offer === undefined) { throw new Error('expected an offer'); }

        const res = await request(booted.app, 'POST', `/api/deletion-offers/${ offer.id }/decline`, bob.cookie);

        expect(res.status).toBe(204);
        expect((await listOffers(bob.cookie)).offers).toEqual([]);
        expect(await blobDeletedAt()).not.toBeNull();
    });

    it('mints no offers when the owner deletes without the opt-in', async () =>
    {
        const folderID = await createFolder(booted.app, alice.cookie, 'shared');
        await grantShare(booted.app, alice.cookie, folderID, bob.id, 'viewer');
        const upload = await uploadSmallFile(booted.app, alice.cookie, bytes, folderID);
        const node = await upload.json() as NodeResponse;

        const res = await request(booted.app, 'DELETE', `/api/nodes/${ node.id }`, alice.cookie);

        expect(res.status).toBe(204);
        expect((await listOffers(bob.cookie)).offers).toEqual([]);
    });

    it('hides another user\'s offer from accept', async () =>
    {
        await deleteSharedFileWithOffer();
        const carol = await makeUser(booted, 'carol@example.com');
        const offer = (await listOffers(bob.cookie)).offers[0];
        if(offer === undefined) { throw new Error('expected an offer'); }

        const acceptPath = `/api/deletion-offers/${ offer.id }/accept`;
        const res = await request(booted.app, 'POST', acceptPath, carol.cookie, { parentID: null });

        expect(res.status).toBe(404);
        expect((await listOffers(bob.cookie)).offers).toHaveLength(1);
    });

    it('requires a session on every offer endpoint', async () =>
    {
        const listRes = await request(booted.app, 'GET', '/api/deletion-offers');
        const acceptRes = await request(booted.app, 'POST', '/api/deletion-offers/x/accept', undefined, {
            parentID: null,
        });
        const declineRes = await request(booted.app, 'POST', '/api/deletion-offers/x/decline');

        expect(listRes.status).toBe(401);
        expect(acceptRes.status).toBe(401);
        expect(declineRes.status).toBe(401);
    });
});

//----------------------------------------------------------------------------------------------------------------------
