//----------------------------------------------------------------------------------------------------------------------
// Status Manager — the admin overview aggregates
//
// Drives the real manager over a real database: accounts created through better-auth's own sign-up (so the user rows
// carry the columns better-auth actually writes), nodes and blobs through their real RAs, zero mocks below the
// resource-access seam. What is asserted is what the overview promises -- that the three byte totals answer three
// different questions, that trash is charged and queued at the same time, and that the instance switches are read at
// request time rather than snapshotted.
//----------------------------------------------------------------------------------------------------------------------

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

// Models
import { type AdminOverview, ForbiddenError, MS_PER_DAY, MS_PER_SECOND } from '@fileshed/core';

// Resource Access
import { BlobRA } from '@server/resource-access/blob/index.ts';
import { NodeRA } from '@server/resource-access/nodes/node.ts';
import { ShareRA } from '@server/resource-access/shares/index.ts';
import { UserRA } from '@server/resource-access/users/index.ts';
import { seedDefaultBackend } from '@server/resource-access/database/seeds.ts';

// Managers
import { LastRunTracker } from '@server/managers/lastRun.ts';
import { StatusManager } from '@server/managers/status.ts';

// Support
import { type BootedApp, bootFullApp, makeAdmin, signUp } from '../auth/support.ts';
import { fileNode, folderNode, linkNode } from '../resource-access/nodes/support.ts';
import { testActor } from '../nodes/support.ts';

//----------------------------------------------------------------------------------------------------------------------

const PASSWORD = 'correct-horse-battery';
const UPTIME_SECONDS = 90;

const ADMIN = testActor({ id: 'admin-actor', role: 'admin' });

let booted : BootedApp;
let backendID : string;
let nodes : NodeRA;
let blob : BlobRA;
let shares : ShareRA;
let manager : StatusManager;

// The live switches the overview reads per request; each test moves them and re-reads.
let emailConfigured : boolean;
let signUpsOpen : boolean;

beforeEach(async () =>
{
    booted = await bootFullApp();
    backendID = await seedDefaultBackend(booted.handle, booted.config);

    nodes = new NodeRA(booted.handle);
    blob = new BlobRA(booted.handle);
    shares = new ShareRA(booted.handle);

    emailConfigured = false;
    signUpsOpen = true;

    manager = new StatusManager({
        blob,
        nodes,
        users: new UserRA(booted.handle),
        shares,
        tracker: new LastRunTracker(),
        version: '9.9.9',
        databaseKind: booted.handle.kind,
        startedAt: new Date(Date.now() - (UPTIME_SECONDS * MS_PER_SECOND)),
        activeProviders: 2,
        emailEnabled: async () => emailConfigured,
        signUpEnabled: async () => signUpsOpen,
    });
});

afterEach(async () =>
{
    await booted.handle.db.destroy();
});

//----------------------------------------------------------------------------------------------------------------------

async function overview() : Promise<AdminOverview>
{
    return (await manager.status(ADMIN)).overview;
}

async function createUser(email : string) : Promise<string>
{
    await signUp(booted.app, email, PASSWORD);

    const row = await booted.handle.db
        .selectFrom('user')
        .select('id')
        .where('email', '=', email)
        .executeTakeFirstOrThrow();

    return row.id;
}

async function storeBlob(sha256 : string, size : number) : Promise<void>
{
    await blob.insertOrResurrect({ sha256, size, backendID, storageKey: sha256 });
}

//----------------------------------------------------------------------------------------------------------------------

describe('StatusManager.status', () =>
{
    it('refuses a caller who is not an admin', async () =>
    {
        await expect(manager.status(testActor({ id: 'member', role: 'user' }))).rejects.toThrow(ForbiddenError);
    });

    it('reports zeros for an instance holding nothing, never a null total', async () =>
    {
        const view = await overview();

        expect(view.users).toEqual({ total: 0, admins: 0, banned: 0, newThisWeek: 0 });
        expect(view.nodes).toEqual({ files: 0, folders: 0 });
        expect(view.storage).toEqual({ logicalBytes: 0, physicalBytes: 0, graveyardBytes: 0, graveyardCount: 0 });
        expect(view.trash).toEqual({ count: 0, bytes: 0 });
        expect(view.accessRequestsPending).toBe(0);
    });

    it('counts every account, and the admins and the banned among them', async () =>
    {
        await makeAdmin(booted, 'root@example.com', PASSWORD);
        await createUser('alice@example.com');
        await createUser('bob@example.com');

        await booted.handle.db
            .updateTable('user')
            .set({ banned: 1 })
            .where('email', '=', 'bob@example.com')
            .execute();

        const view = await overview();

        expect(view.users.total).toBe(3);
        expect(view.users.admins).toBe(1);
        expect(view.users.banned).toBe(1);
    });

    it('counts an account created within the week and not one created a month ago', async () =>
    {
        await createUser('fresh@example.com');
        await createUser('veteran@example.com');

        await booted.handle.db
            .updateTable('user')
            .set({ createdAt: new Date(Date.now() - (30 * MS_PER_DAY)).toISOString() })
            .where('email', '=', 'veteran@example.com')
            .execute();

        const view = await overview();

        expect(view.users.total).toBe(2);
        expect(view.users.newThisWeek).toBe(1);
    });

    it('counts live files and folders, and counts neither a trashed node nor a link', async () =>
    {
        const ownerID = await createUser('owner@example.com');
        await storeBlob('sha-live', 100);

        await nodes.insert(folderNode({ id: 'folder-1', ownerID }));
        await nodes.insert(fileNode({ id: 'file-1', ownerID, blobID: 'sha-live' }));
        await nodes.insert(fileNode({ id: 'file-2', ownerID, blobID: 'sha-live' }));
        await nodes.insert(fileNode({ id: 'file-trashed', ownerID, blobID: 'sha-live', trashedAt: new Date() }));
        await nodes.insert(linkNode({ id: 'link-1', ownerID, targetNodeID: 'file-1' }));

        const view = await overview();

        expect(view.nodes).toEqual({ files: 2, folders: 1 });
    });

    it('still charges a trashed file in logical bytes while reporting it as trash pending', async () =>
    {
        const ownerID = await createUser('owner@example.com');
        await storeBlob('sha-kept', 1000);
        await storeBlob('sha-tossed', 500);

        await nodes.insert(fileNode({ id: 'kept', ownerID, blobID: 'sha-kept', size: 1000 }));
        await nodes.insert(fileNode({
            id: 'tossed',
            ownerID,
            blobID: 'sha-tossed',
            size: 500,
            trashedAt: new Date(),
        }));

        const view = await overview();

        expect(view.storage.logicalBytes).toBe(1500);
        expect(view.trash).toEqual({ count: 1, bytes: 500 });
    });

    it('charges two copies of one blob twice logically and once physically', async () =>
    {
        const ownerID = await createUser('owner@example.com');
        await storeBlob('sha-shared', 800);

        await nodes.insert(fileNode({ id: 'original', ownerID, blobID: 'sha-shared', size: 800 }));
        await nodes.insert(fileNode({ id: 'duplicate', ownerID, blobID: 'sha-shared', size: 800 }));

        const view = await overview();

        expect(view.storage.logicalBytes).toBe(1600);
        expect(view.storage.physicalBytes).toBe(800);
    });

    it('aggregates across every owner, never scoping to one of them', async () =>
    {
        const alice = await createUser('alice@example.com');
        const bob = await createUser('bob@example.com');

        await storeBlob('sha-alice', 300);
        await storeBlob('sha-bob', 700);

        await nodes.insert(folderNode({ id: 'alice-folder', ownerID: alice }));
        await nodes.insert(fileNode({ id: 'alice-file', ownerID: alice, blobID: 'sha-alice', size: 300 }));
        await nodes.insert(fileNode({ id: 'bob-file', ownerID: bob, blobID: 'sha-bob', size: 700 }));
        await nodes.insert(fileNode({
            id: 'bob-trashed',
            ownerID: bob,
            blobID: 'sha-bob',
            size: 700,
            trashedAt: new Date(),
        }));

        const view = await overview();

        expect(view.nodes).toEqual({ files: 2, folders: 1 });
        expect(view.storage.logicalBytes).toBe(1700);
        expect(view.trash).toEqual({ count: 1, bytes: 700 });
    });

    it('moves a graveyarded blob out of physical storage and into the reclaimable graveyard', async () =>
    {
        const ownerID = await createUser('owner@example.com');
        await storeBlob('sha-referenced', 1000);
        await storeBlob('sha-orphaned', 400);

        await nodes.insert(fileNode({ id: 'file-1', ownerID, blobID: 'sha-referenced', size: 1000 }));
        await blob.graveyardUnreferenced([ 'sha-orphaned' ]);

        const view = await overview();

        expect(view.storage.physicalBytes).toBe(1000);
        expect(view.storage.graveyardBytes).toBe(400);
        expect(view.storage.graveyardCount).toBe(1);
    });

    it('counts access requests still waiting and not the ones already resolved', async () =>
    {
        const alice = await createUser('alice@example.com');
        const bob = await createUser('bob@example.com');
        const requesterID = await createUser('asker@example.com');

        await nodes.insert(folderNode({ id: 'alice-folder', ownerID: alice }));
        await nodes.insert(folderNode({ id: 'bob-folder', ownerID: bob }));
        await nodes.insert(folderNode({ id: 'settled-folder', ownerID: alice }));

        // Two owners with an open request each: the count is instance-wide, not one owner's queue.
        await shares.insertRequest({
            id: 'request-alice',
            nodeID: 'alice-folder',
            requesterID,
            requestedRole: 'viewer',
            message: null,
            status: 'pending',
            resolvedAt: null,
            createdAt: new Date(),
        });
        await shares.insertRequest({
            id: 'request-bob',
            nodeID: 'bob-folder',
            requesterID,
            requestedRole: 'viewer',
            message: null,
            status: 'pending',
            resolvedAt: null,
            createdAt: new Date(),
        });
        await shares.insertRequest({
            id: 'request-settled',
            nodeID: 'settled-folder',
            requesterID,
            requestedRole: 'editor',
            message: null,
            status: 'pending',
            resolvedAt: null,
            createdAt: new Date(),
        });
        await shares.resolveRequest('request-settled', 'granted', new Date());

        const view = await overview();

        expect(view.accessRequestsPending).toBe(2);
    });

    it('reports the build, the dialect, and how long the process has been up', async () =>
    {
        const view = await overview();

        expect(view.instance.version).toBe('9.9.9');
        expect(view.instance.databaseKind).toBe(booted.handle.kind);
        expect(view.instance.activeProviders).toBe(2);
        expect(view.instance.uptimeSeconds).toBeGreaterThanOrEqual(UPTIME_SECONDS);
    });

    it('reads the email and sign-up switches at request time, not at construction', async () =>
    {
        const before = await overview();

        expect(before.instance.emailEnabled).toBe(false);
        expect(before.instance.signUpEnabled).toBe(true);

        emailConfigured = true;
        signUpsOpen = false;

        const after = await overview();

        expect(after.instance.emailEnabled).toBe(true);
        expect(after.instance.signUpEnabled).toBe(false);
    });
});

//----------------------------------------------------------------------------------------------------------------------
