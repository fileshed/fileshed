//----------------------------------------------------------------------------------------------------------------------
// Admin Route — DELETE /api/admin/users/:id
//
// Deleting an account has to release what it was holding. The user row cascades to their nodes, so a plain row delete
// takes the rows and strands the bytes behind them: nothing references them and nothing can find them, because the
// only thing that ever offers a blob to the collector is the node delete that stopped referencing it. So these drive
// the real store -- real uploads, real files on disk -- and then run the collector to see whether the bytes actually
// go.
//
// The counter-case matters as much: content two accounts both hold is one blob, and one of them leaving must not take
// it from the other.
//----------------------------------------------------------------------------------------------------------------------

import { createHash, randomBytes } from 'node:crypto';
import { Readable } from 'node:stream';

import { afterEach, describe, expect, it } from 'vitest';
import type { Hono } from 'hono';

import { createId } from '@paralleldrive/cuid2';

import type { ClaimResponse, NodeResponse } from '@fileshed/core';

// Managers
import { AdminManager } from '@server/managers/admin.ts';
import { AvatarManager } from '@server/managers/avatar.ts';
import { NodeManager } from '@server/managers/node.ts';
import { SessionManager } from '@server/managers/session.ts';
import { deleteAccount } from '@server/managers/accountDeletion.ts';
import { runGcOnce } from '@server/managers/gc.ts';

// Resource Access
import { NodeRA } from '@server/resource-access/nodes/node.ts';
import { ShareRA } from '@server/resource-access/shares/index.ts';
import { UserRA } from '@server/resource-access/users/index.ts';

// Routes
import { createAdminRoutes } from '@server/routes/admin.ts';

// Support
import { ORIGIN, cookieFrom, signIn, signUp } from './support.ts';
import { REAL_PNG } from '../support/imageBytes.ts';
import {
    type BootedBlobApp,
    type TestUser,
    bootBlobApp,
    bytesExist,
    claim,
    fileNodesForBlob,
    makeUser,
    putUpload,
} from '../blobs/support.ts';

//----------------------------------------------------------------------------------------------------------------------

const PASSWORD = 'correct-horse-battery';
const UNLIMITED = 0;

let booted : BootedBlobApp;
let avatars : AvatarManager;

function sha256Of(data : Buffer) : string
{
    return createHash('sha256')
        .update(data)
        .digest('hex');
}

// The real deletion, mounted on the blob app's own database and store, so a delete moves the same rows and the same
// bytes a deployment's would.
async function bootWithAdminRoutes() : Promise<void>
{
    booted = await bootBlobApp();

    const nodeRA = new NodeRA(booted.handle);
    const nodes = new NodeManager(booted.handle, nodeRA, booted.blob, { defaultQuota: async () => UNLIMITED });
    avatars = new AvatarManager({
        handle: booted.handle,
        blob: booted.blob,
        avatarMaxBytes: async () => 5_000_000,
    });

    booted.app.route('/api', createAdminRoutes(
        new SessionManager(booted.auth),
        new AdminManager({
            auth: booted.auth,
            users: new UserRA(booted.handle),
            usage: async () => new Map(),
            deleteAccount: (userID) => deleteAccount({
                auth: booted.auth,
                nodes: nodeRA,
                shares: new ShareRA(booted.handle),
                purger: nodes,
                avatars,
            }, userID),
            defaultQuota: async () => UNLIMITED,
        })
    ));
}

async function adminCookie(email = 'root@example.com') : Promise<string>
{
    await signUp(booted.app, email, PASSWORD);
    await booted.handle.db.updateTable('user').set({ role: 'admin' })
        .where('email', '=', email)
        .execute();

    return cookieFrom(await signIn(booted.app, email, PASSWORD));
}

async function deleteUser(app : Hono, userID : string, cookie ?: string) : Promise<Response>
{
    return app.request(`${ ORIGIN }/api/admin/users/${ userID }`, {
        method: 'DELETE',
        ...cookie === undefined ? {} : { headers: { cookie } },
    });
}

// One file, uploaded for real: the bytes land in the store and the node row charges them to its owner.
async function uploadFile(user : TestUser, data : Buffer, name : string) : Promise<NodeResponse>
{
    const claimed = await claim(booted.app, user.cookie, sha256Of(data), data.length)
        .then((res) => res.json()) as ClaimResponse;
    if(claimed.upload !== true) { throw new Error('expected an upload ticket'); }

    const res = await putUpload(booted.app, user.cookie, claimed.ticket, data, {
        name,
        parentID: null,
        mimeType: 'application/octet-stream',
    });

    return await res.json() as NodeResponse;
}

async function userExists(email : string) : Promise<boolean>
{
    const row = await booted.handle.db.selectFrom('user').select('id')
        .where('email', '=', email)
        .executeTakeFirst();

    return row !== undefined;
}

// Everything the collector will take once nothing stands in its way: no grace, so a blob offered to it this instant
// is due this instant.
async function collectNow() : Promise<void>
{
    await runGcOnce({ blob: booted.blob, graceMs: async () => 0 });
}

//----------------------------------------------------------------------------------------------------------------------

afterEach(async () =>
{
    await booted.cleanup();
});

//----------------------------------------------------------------------------------------------------------------------

describe('DELETE /api/admin/users/:id', () =>
{
    it('refuses an anonymous request with 401', async () =>
    {
        await bootWithAdminRoutes();
        const victim = await makeUser(booted, 'anon-target@example.com');

        expect((await deleteUser(booted.app, victim.id)).status).toBe(401);
        expect(await userExists('anon-target@example.com')).toBe(true);
    });

    it('refuses a signed-in non-admin with 403', async () =>
    {
        await bootWithAdminRoutes();
        const meddler = await makeUser(booted, 'meddler@example.com');
        const victim = await makeUser(booted, 'not-yours@example.com');

        expect((await deleteUser(booted.app, victim.id, meddler.cookie)).status).toBe(403);
        expect(await userExists('not-yours@example.com')).toBe(true);
    });

    it('answers 404 for an id no account has', async () =>
    {
        await bootWithAdminRoutes();
        const cookie = await adminCookie();

        expect((await deleteUser(booted.app, createId(), cookie)).status).toBe(404);
    });

    // Closing your own account is a decision made in your own account area. Refusing it here also means the caller is
    // always an admin other than the target, so this surface can never take the last admin.
    it('refuses an admin deleting their own account, leaving it standing', async () =>
    {
        await bootWithAdminRoutes();
        const cookie = await adminCookie('self@example.com');
        const row = await booted.handle.db.selectFrom('user').select('id')
            .where('email', '=', 'self@example.com')
            .executeTakeFirstOrThrow();

        expect((await deleteUser(booted.app, row.id, cookie)).status).toBe(400);
        expect(await userExists('self@example.com')).toBe(true);
    });
});

//----------------------------------------------------------------------------------------------------------------------

describe('what a deleted account releases', () =>
{
    it('releases the storage its files held, and the collector takes the bytes', async () =>
    {
        await bootWithAdminRoutes();
        const cookie = await adminCookie();
        const leaver = await makeUser(booted, 'leaver@example.com');

        const data = randomBytes(512);
        const sha256 = sha256Of(data);
        await uploadFile(leaver, data, 'report.bin');

        expect(await bytesExist(booted, sha256)).toBe(true);

        expect((await deleteUser(booted.app, leaver.id, cookie)).status).toBe(204);

        expect(await fileNodesForBlob(booted.handle, sha256)).toHaveLength(0);
        expect(await userExists('leaver@example.com')).toBe(false);

        await collectNow();

        expect(await bytesExist(booted, sha256)).toBe(false);
    });

    // Trash is still their storage and is still charged to them, so it goes the same way -- and a purge sweep that
    // never runs again must not be the only thing that would have freed it.
    it('releases what was sitting in its trash', async () =>
    {
        await bootWithAdminRoutes();
        const cookie = await adminCookie();
        const leaver = await makeUser(booted, 'trasher@example.com');

        const data = randomBytes(512);
        const sha256 = sha256Of(data);
        const node = await uploadFile(leaver, data, 'discarded.bin');

        await booted.app.request(`${ ORIGIN }/api/nodes/${ node.id }/trash`, {
            method: 'POST',
            headers: { cookie: leaver.cookie },
        });

        expect((await deleteUser(booted.app, leaver.id, cookie)).status).toBe(204);
        await collectNow();

        expect(await bytesExist(booted, sha256)).toBe(false);
    });

    // Two accounts holding the same content hold one blob between them. The leaver's node stops referencing it; the
    // stayer's still does, so the collector must find nothing to take.
    it('leaves content another account also holds exactly where it is', async () =>
    {
        await bootWithAdminRoutes();
        const cookie = await adminCookie();
        const leaver = await makeUser(booted, 'leaving@example.com');
        const stayer = await makeUser(booted, 'staying@example.com');

        const data = randomBytes(512);
        const sha256 = sha256Of(data);
        await uploadFile(leaver, data, 'shared-content.bin');
        await uploadFile(stayer, data, 'my-own-copy.bin');

        expect((await deleteUser(booted.app, leaver.id, cookie)).status).toBe(204);
        await collectNow();

        expect(await bytesExist(booted, sha256)).toBe(true);
        const remaining = await fileNodesForBlob(booted.handle, sha256);
        expect(remaining.map((row) => row.owner_id)).toEqual([ stayer.id ]);
    });

    // The avatar's bytes live in the same content-addressed store but hang off the user row rather than a node, so
    // nothing about the drive's deletion would ever reach them.
    it('releases the bytes behind its avatar', async () =>
    {
        await bootWithAdminRoutes();
        const cookie = await adminCookie();
        const leaver = await makeUser(booted, 'has-avatar@example.com');

        await avatars.setAvatar(leaver.id, Readable.from([ REAL_PNG ]), 'image/png', REAL_PNG.length);
        const sha256 = sha256Of(REAL_PNG);

        expect(await bytesExist(booted, sha256)).toBe(true);

        expect((await deleteUser(booted.app, leaver.id, cookie)).status).toBe(204);
        await collectNow();

        expect(await bytesExist(booted, sha256)).toBe(false);
    });

    // share.created_by is the one column pointing at a user with no ON DELETE on it, so a grant that outlived its
    // creator does not linger -- it refuses the user delete outright. Only a node's owner may grant today, which means
    // the node delete has already cascaded these away and the row below has to be written straight into the table to
    // exist at all. That is the point: this is the backstop for the day granting widens past owners.
    it('deletes a grant that would otherwise refuse the delete', async () =>
    {
        await bootWithAdminRoutes();
        const cookie = await adminCookie();
        const leaver = await makeUser(booted, 'granter@example.com');
        const owner = await makeUser(booted, 'owner@example.com');
        const grantee = await makeUser(booted, 'grantee@example.com');

        const node = await uploadFile(owner, randomBytes(64), 'owners-file.bin');

        const shares = new ShareRA(booted.handle);
        await shares.upsertShare({
            id: createId(),
            nodeID: node.id,
            granteeUserID: grantee.id,
            role: 'viewer',
            createdBy: leaver.id,
            createdAt: new Date(),
        });

        expect((await deleteUser(booted.app, leaver.id, cookie)).status).toBe(204);

        expect(await shares.listByNode(node.id)).toHaveLength(0);
    });
});

//----------------------------------------------------------------------------------------------------------------------
