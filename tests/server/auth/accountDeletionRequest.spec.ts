//----------------------------------------------------------------------------------------------------------------------
// Self-Service Account Deletion — request, wait, cancel
//
// The whole point of the design is that the two halves happen at different times. What the account can REACH dies the
// moment it asks -- the shares it granted, the links it published, its tokens, its sessions -- so a stolen session
// cannot go on using it. What the account HOLDS survives the window, so the person who actually owns it can notice and
// say no. These drive the real app: real sign-ups, real grants, real links, real sessions.
//
// Cancelling is deliberately not symmetric. It brings the account back and none of the revocations with it, which the
// UI says before the request is made and these say again here.
//----------------------------------------------------------------------------------------------------------------------

/* eslint-disable camelcase -- the seeded blob row names snake_case DB columns (house convention for Kysely) */

import { afterEach, describe, expect, it } from 'vitest';

import { createId } from '@paralleldrive/cuid2';

import type { MeResponse, NodeResponse } from '@fileshed/core';

// Managers
import { runAccountDeletionOnce } from '@server/managers/accountDeletionSweep.ts';
import { deleteAccount } from '@server/managers/accountDeletion.ts';
import { NodeManager } from '@server/managers/node.ts';

// Resource Access
import { BlobRA } from '@server/resource-access/blob/index.ts';
import { seedDefaultBackend } from '@server/resource-access/database/seeds.ts';
import { NodeRA } from '@server/resource-access/nodes/node.ts';
import { PublicLinkRA } from '@server/resource-access/publicLinks/index.ts';
import { ShareRA } from '@server/resource-access/shares/index.ts';
import { UserRA } from '@server/resource-access/users/index.ts';

// Managers
import { AvatarManager } from '@server/managers/avatar.ts';

// Support
import { type BootedApp, ORIGIN, bootFullApp, cookieFrom, signIn, signUp } from './support.ts';

//----------------------------------------------------------------------------------------------------------------------

const PASSWORD = 'correct-horse-battery';
const MS_PER_DAY = 24 * 60 * 60 * 1000;

let booted : BootedApp;

interface Signed
{
    id : string;
    email : string;
    cookie : string;
}

async function register(email : string) : Promise<Signed>
{
    await signUp(booted.app, email, PASSWORD);
    const cookie = cookieFrom(await signIn(booted.app, email, PASSWORD));
    const row = await booted.handle.db.selectFrom('user').select('id')
        .where('email', '=', email)
        .executeTakeFirstOrThrow();

    return { id: row.id, email, cookie };
}

async function promote(email : string) : Promise<void>
{
    await booted.handle.db.updateTable('user').set({ role: 'admin' })
        .where('email', '=', email)
        .execute();
}

async function api(path : string, cookie : string | undefined, init : RequestInit = {}) : Promise<Response>
{
    return booted.app.request(`${ ORIGIN }${ path }`, {
        ...init,
        headers: { ...init.headers, ...cookie === undefined ? {} : { cookie } },
    });
}

async function me(cookie : string) : Promise<MeResponse>
{
    const res = await api('/api/me', cookie);
    if(res.status !== 200) { throw new Error(`GET /api/me answered ${ res.status }`); }

    return await res.json() as MeResponse;
}

async function requestDeletion(cookie : string) : Promise<Response>
{
    return api('/api/me/deletion', cookie, { method: 'POST' });
}

async function cancelDeletion(cookie : string) : Promise<Response>
{
    return api('/api/me/deletion', cookie, { method: 'DELETE' });
}

// A file node with a blob row behind it, inserted straight into the database. Nothing here is about uploading, and a
// public link only cares that its target is a file.
async function makeFile(ownerID : string, name : string) : Promise<string>
{
    const backendID = await seedDefaultBackend(booted.handle, booted.config);
    const sha256 = createId()
        .padEnd(64, '0')
        .slice(0, 64);
    const now = new Date();

    await booted.handle.db
        .insertInto('blob')
        .values({
            sha256,
            size: 8,
            backend_id: backendID,
            storage_key: sha256,
            created_at: now.toISOString(),
            deleted_at: null,
        })
        .execute();

    const id = createId();
    await new NodeRA(booted.handle).insert({
        type: 'file',
        id,
        name,
        ownerID,
        parentID: null,
        blobID: sha256,
        size: 8,
        mimeType: 'application/octet-stream',
        createdAt: now,
        updatedAt: now,
        trashedAt: null,
    });

    return id;
}

async function makeFolder(cookie : string, name : string) : Promise<NodeResponse>
{
    const res = await api('/api/nodes', cookie, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ type: 'folder', name, parentID: null }),
    });

    return await res.json() as NodeResponse;
}

// A fresh session for an account whose sessions the request just ended -- what the person actually deleting their
// account does next, since password sign-in stays open on purpose.
async function signInAgain(email : string) : Promise<string>
{
    return cookieFrom(await signIn(booted.app, email, PASSWORD));
}

async function nodeCount(ownerID : string) : Promise<number>
{
    const rows = await booted.handle.db.selectFrom('node').select('id')
        .where('owner_id', '=', ownerID)
        .execute();

    return rows.length;
}

async function stampRequestedAt(userID : string, at : Date) : Promise<void>
{
    await new UserRA(booted.handle).setDeletionRequestedAt(userID, at);
}

// The sweep, on the same database, with the window a spec chooses.
async function runSweep(days : number) : Promise<{ candidates : number; deleted : number; failed : number }>
{
    const nodeRA = new NodeRA(booted.handle);
    const blob = new BlobRA(booted.handle);
    const nodes = new NodeManager(booted.handle, nodeRA, blob, { defaultQuota: async () => 0 });

    return runAccountDeletionOnce({
        users: new UserRA(booted.handle),
        deleteAccount: (userID) => deleteAccount({
            auth: booted.auth,
            nodes: nodeRA,
            shares: new ShareRA(booted.handle),
            purger: nodes,
            avatars: new AvatarManager({
                handle: booted.handle,
                blob,
                avatarMaxBytes: async () => 5_000_000,
            }),
        }, userID),
        windowMs: async () => days * MS_PER_DAY,
    });
}

//----------------------------------------------------------------------------------------------------------------------

afterEach(async () =>
{
    await booted.handle.db.destroy();
});

//----------------------------------------------------------------------------------------------------------------------

describe('POST /api/me/deletion', () =>
{
    it('refuses an anonymous request with 401', async () =>
    {
        booted = await bootFullApp();

        expect((await requestDeletion('')).status).toBe(401);
    });

    it('answers the date the account is scheduled to be deleted', async () =>
    {
        booted = await bootFullApp({ ACCOUNT_DELETION_DAYS: 14 });
        const user = await register('leaving@example.com');

        const res = await requestDeletion(user.cookie);
        const body = await res.json() as MeResponse;

        expect(res.status).toBe(200);
        expect(body.deletion).not.toBeNull();

        const requestedAt = new Date(body.deletion?.requestedAt ?? '').getTime();
        const scheduledFor = new Date(body.deletion?.scheduledFor ?? '').getTime();
        expect(scheduledFor - requestedAt).toBe(14 * MS_PER_DAY);
    });

    // Asking twice is a double-click, not a decision to start over. Restarting the window would let a thief who kept
    // pressing it push the deletion further out than the owner ever agreed to.
    it('leaves the standing schedule alone when asked twice', async () =>
    {
        booted = await bootFullApp();
        const user = await register('twice@example.com');

        const first = await (await requestDeletion(user.cookie)).json() as MeResponse;

        const second = await requestDeletion(await signInAgain(user.email));
        const body = await second.json() as MeResponse;

        expect(second.status).toBe(200);
        expect(body.deletion?.requestedAt).toBe(first.deletion?.requestedAt);
    });

    // An instance whose only admin deletes themselves has no way back short of the database.
    it('refuses the only admin', async () =>
    {
        booted = await bootFullApp();
        const admin = await register('root@example.com');
        await promote('root@example.com');

        const res = await requestDeletion(await signInAgain(admin.email));

        expect(res.status).toBe(400);
        expect(await me(await signInAgain(admin.email))).toMatchObject({ deletion: null });
    });

    it('lets an admin go once somebody else can administer the instance', async () =>
    {
        booted = await bootFullApp();
        const leaving = await register('leaving-admin@example.com');
        await register('staying-admin@example.com');
        await promote('leaving-admin@example.com');
        await promote('staying-admin@example.com');

        const res = await requestDeletion(await signInAgain(leaving.email));

        expect(res.status).toBe(200);
    });
});

//----------------------------------------------------------------------------------------------------------------------

describe('what the request revokes immediately', () =>
{
    it('drops every share on the account\'s files', async () =>
    {
        booted = await bootFullApp();
        const leaving = await register('granter@example.com');
        const friend = await register('friend@example.com');

        const folder = await makeFolder(leaving.cookie, 'Shared Out');
        const granted = await api(`/api/nodes/${ folder.id }/shares`, leaving.cookie, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ granteeUserID: friend.id, role: 'viewer' }),
        });
        expect(granted.status).toBe(201);

        await requestDeletion(leaving.cookie);

        expect(await new ShareRA(booted.handle).listByNode(folder.id)).toHaveLength(0);
    });

    // The other direction is deliberately left alone: a grant somebody else made is theirs to revoke, and this
    // account cannot use it anyway while the window runs.
    it('leaves the shares other people granted it', async () =>
    {
        booted = await bootFullApp();
        const leaving = await register('grantee@example.com');
        const friend = await register('grantor@example.com');

        const folder = await makeFolder(friend.cookie, 'Theirs');
        await api(`/api/nodes/${ folder.id }/shares`, friend.cookie, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ granteeUserID: leaving.id, role: 'viewer' }),
        });

        await requestDeletion(leaving.cookie);

        expect(await new ShareRA(booted.handle).listByNode(folder.id)).toHaveLength(1);
    });

    it('revokes every public link on the account\'s files', async () =>
    {
        booted = await bootFullApp();
        const leaving = await register('publisher@example.com');
        const fileID = await makeFile(leaving.id, 'published.bin');

        const created = await api(`/api/nodes/${ fileID }/links`, leaving.cookie, { method: 'POST' });
        expect(created.status).toBe(201);

        await requestDeletion(leaving.cookie);

        const links = await new PublicLinkRA(booted.handle).listByNode(fileID);
        expect(links).toHaveLength(1);
        expect(links[0]?.revokedAt).not.toBeNull();
    });

    it('ends the sessions the account holds, including the one that asked', async () =>
    {
        booted = await bootFullApp();
        const leaving = await register('signed-out@example.com');

        await requestDeletion(leaving.cookie);

        expect((await api('/api/me', leaving.cookie)).status).toBe(401);
    });

    it('leaves the account\'s own files exactly where they are', async () =>
    {
        booted = await bootFullApp();
        const leaving = await register('keeps-files@example.com');
        await makeFolder(leaving.cookie, 'Still Mine');

        await requestDeletion(leaving.cookie);

        expect(await nodeCount(leaving.id)).toBe(1);
    });
});

//----------------------------------------------------------------------------------------------------------------------

describe('what an account can still do during the window', () =>
{
    it('signs in, and reads its own profile with the schedule on it', async () =>
    {
        booted = await bootFullApp({ ACCOUNT_DELETION_DAYS: 7 });
        const leaving = await register('waiting@example.com');
        await requestDeletion(leaving.cookie);

        const profile = await me(await signInAgain(leaving.email));

        expect(profile.deletion).not.toBeNull();
    });

    // The interstitial is not a client-side courtesy: an account on its way out is refused everywhere else, so a
    // script holding a session cannot go on using it while the window runs.
    it('is refused everywhere else', async () =>
    {
        booted = await bootFullApp();
        const leaving = await register('locked-out@example.com');
        await requestDeletion(leaving.cookie);

        const cookie = await signInAgain(leaving.email);

        expect((await api('/api/nodes/children', cookie)).status).toBe(403);
        expect((await api('/api/trash', cookie)).status).toBe(403);
        expect((await makeFolder(cookie, 'Nope')).id).toBeUndefined();
    });

    it('calls the deletion off', async () =>
    {
        booted = await bootFullApp();
        const leaving = await register('changed-mind@example.com');
        await requestDeletion(leaving.cookie);

        const cookie = await signInAgain(leaving.email);
        const res = await cancelDeletion(cookie);

        expect(res.status).toBe(200);
        expect((await res.json() as MeResponse).deletion).toBeNull();
        expect((await api('/api/nodes/children', cookie)).status).toBe(200);
    });
});

//----------------------------------------------------------------------------------------------------------------------

describe('cancelling', () =>
{
    // Said plainly in the dialog before the request is made: this brings the account back, not the reach it had.
    it('does not restore the shares and links the request revoked', async () =>
    {
        booted = await bootFullApp();
        const leaving = await register('undo@example.com');
        const friend = await register('undo-friend@example.com');
        const fileID = await makeFile(leaving.id, 'was-shared.bin');

        await api(`/api/nodes/${ fileID }/shares`, leaving.cookie, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ granteeUserID: friend.id, role: 'viewer' }),
        });
        await api(`/api/nodes/${ fileID }/links`, leaving.cookie, { method: 'POST' });

        await requestDeletion(leaving.cookie);
        await cancelDeletion(await signInAgain(leaving.email));

        expect(await new ShareRA(booted.handle).listByNode(fileID)).toHaveLength(0);
        expect((await new PublicLinkRA(booted.handle).listByNode(fileID))[0]?.revokedAt).not.toBeNull();
    });

    it('leaves the files and folders untouched', async () =>
    {
        booted = await bootFullApp();
        const leaving = await register('files-survive@example.com');
        await makeFolder(leaving.cookie, 'Survivor');

        await requestDeletion(leaving.cookie);
        const cookie = await signInAgain(leaving.email);
        await cancelDeletion(cookie);

        expect(await nodeCount(leaving.id)).toBe(1);
    });
});

//----------------------------------------------------------------------------------------------------------------------

describe('the sweep that carries deletions out', () =>
{
    it('deletes an account whose window has run out', async () =>
    {
        booted = await bootFullApp();
        const leaving = await register('due@example.com');
        await makeFolder(leaving.cookie, 'Going With Me');

        await stampRequestedAt(leaving.id, new Date(Date.now() - (31 * MS_PER_DAY)));

        expect(await runSweep(30)).toEqual({ candidates: 1, deleted: 1, failed: 0 });

        expect(await nodeCount(leaving.id)).toBe(0);
        const row = await booted.handle.db.selectFrom('user').select('id')
            .where('id', '=', leaving.id)
            .executeTakeFirst();
        expect(row).toBeUndefined();
    });

    it('leaves an account still inside its window alone', async () =>
    {
        booted = await bootFullApp();
        const leaving = await register('not-yet@example.com');

        await stampRequestedAt(leaving.id, new Date(Date.now() - (2 * MS_PER_DAY)));

        expect(await runSweep(30)).toEqual({ candidates: 0, deleted: 0, failed: 0 });
        expect(await nodeCount(leaving.id)).toBe(0);
        expect(await me(await signInAgain(leaving.email))).toMatchObject({ id: leaving.id });
    });

    it('never touches an account that asked for nothing', async () =>
    {
        booted = await bootFullApp();
        const staying = await register('staying@example.com');
        await makeFolder(staying.cookie, 'Mine');

        expect(await runSweep(0)).toEqual({ candidates: 0, deleted: 0, failed: 0 });
        expect(await nodeCount(staying.id)).toBe(1);
    });

    // The due date lives in the setting and the request instant, never in a stored date -- so an admin who lengthens
    // the window spares an account that was about to be taken.
    it('spares an account the window was lengthened past', async () =>
    {
        booted = await bootFullApp();
        const leaving = await register('reprieved@example.com');

        await stampRequestedAt(leaving.id, new Date(Date.now() - (31 * MS_PER_DAY)));

        expect(await runSweep(60)).toEqual({ candidates: 0, deleted: 0, failed: 0 });
        expect(await me(await signInAgain(leaving.email))).toMatchObject({ id: leaving.id });
    });
});

//----------------------------------------------------------------------------------------------------------------------
