//----------------------------------------------------------------------------------------------------------------------
// NodeManager — logic the HTTP surface can't cleanly show
//
// Drives the manager directly against a real NodeRA over in-memory SQLite (zero mocks below the RA seam), with only the
// blob-graveyard collaborator as a recording double. Covers what the route specs can't stage without the upload flow:
// quota usage over seeded file nodes, and the orphaned-blob handoff a hard delete performs.
//----------------------------------------------------------------------------------------------------------------------

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

// Resource Access
import type { DatabaseHandle } from '@server/resource-access/database/database.ts';
import { NodeRA } from '@server/resource-access/nodes/node.ts';

// Managers
import { NodeManager, type OrphanedBlobs } from '@server/managers/node.ts';

// Support
import {
    createTestDatabase,
    fileNode,
    folderNode,
    linkNode,
    seedBackend,
    seedBlob,
    seedUser,
} from '../resource-access/nodes/support.ts';
import { RecordingOrphanedBlobs, noopOrphanedBlobs, testActor } from '../nodes/support.ts';

//----------------------------------------------------------------------------------------------------------------------

let handle : DatabaseHandle;
let ra : NodeRA;

beforeEach(async () =>
{
    handle = await createTestDatabase();
    ra = new NodeRA(handle);

    await seedUser(handle.db, 'alice');
    await seedBackend(handle.db, 'be1');
    await seedBlob(handle.db, 'sha-a', 'be1');
    await seedBlob(handle.db, 'sha-b', 'be1');
});

// A graveyard collaborator that always fails, to prove the delete + handoff are one transaction: if it were two
// statements, the delete would already have committed when this throws.
const throwingOrphanedBlobs : OrphanedBlobs = {
    async graveyardUnreferenced() : Promise<void> { throw new Error('graveyard failed'); },
};

afterEach(async () =>
{
    await handle.db.destroy();
});

//----------------------------------------------------------------------------------------------------------------------

describe('NodeManager.me', () =>
{
    it('charges owned file nodes including trashed, excluding folders and links', async () =>
    {
        await ra.insert(fileNode({ id: 'f1', ownerID: 'alice', blobID: 'sha-a', size: 1000 }));
        await ra.insert(fileNode({ id: 'f2', ownerID: 'alice', blobID: 'sha-a', size: 500, trashedAt: new Date() }));
        await ra.insert(folderNode({ id: 'dir', ownerID: 'alice' }));
        await ra.insert(linkNode({ id: 'lnk', ownerID: 'alice', targetNodeID: 'dir' }));

        const manager = new NodeManager(handle, ra, noopOrphanedBlobs());
        const me = await manager.me(testActor({ id: 'alice', email: 'alice@example.com', quotaLimit: 1_000_000 }));

        expect(me.quota.used).toBe(1500);
        expect(me.quota.limit).toBe(1_000_000);
    });

    // a 0 limit is a real block-all quota, distinct from null (unlimited). The manager must report it verbatim rather
    // than collapsing it to null.
    it('reports a zero quota limit as a real limit, not unlimited', async () =>
    {
        const manager = new NodeManager(handle, ra, noopOrphanedBlobs());
        const me = await manager.me(testActor({ id: 'alice', quotaLimit: 0 }));

        expect(me.quota.limit).toBe(0);
    });
});

//----------------------------------------------------------------------------------------------------------------------

describe('NodeManager.hardDelete', () =>
{
    it('hands the subtree\'s file blob shas to the graveyard after deleting', async () =>
    {
        await ra.insert(folderNode({ id: 'dir', ownerID: 'alice' }));
        await ra.insert(fileNode({ id: 'f1', ownerID: 'alice', blobID: 'sha-a', parentID: 'dir' }));
        await ra.insert(fileNode({ id: 'f2', ownerID: 'alice', blobID: 'sha-b', parentID: 'dir' }));

        const orphaned = new RecordingOrphanedBlobs();
        const manager = new NodeManager(handle, ra, orphaned);

        await manager.hardDelete(testActor({ id: 'alice' }), 'dir');

        expect(await ra.get('dir')).toBeUndefined();
        expect(orphaned.calls).toHaveLength(1);
        expect(new Set(orphaned.calls[0])).toEqual(new Set([ 'sha-a', 'sha-b' ]));
    });

    it('removes a link without reporting any orphaned blobs and leaves its target', async () =>
    {
        await ra.insert(folderNode({ id: 'target', ownerID: 'alice' }));
        await ra.insert(linkNode({ id: 'lnk', ownerID: 'alice', targetNodeID: 'target' }));

        const orphaned = new RecordingOrphanedBlobs();
        const manager = new NodeManager(handle, ra, orphaned);

        await manager.hardDelete(testActor({ id: 'alice' }), 'lnk');

        expect(await ra.get('lnk')).toBeUndefined();
        expect(await ra.get('target')).toBeDefined();
        expect(orphaned.calls).toHaveLength(0);
    });

    it('rolls the subtree delete back when the graveyard handoff fails, stranding nothing', async () =>
    {
        await ra.insert(folderNode({ id: 'dir', ownerID: 'alice' }));
        await ra.insert(fileNode({ id: 'f1', ownerID: 'alice', blobID: 'sha-a', parentID: 'dir' }));

        const manager = new NodeManager(handle, ra, throwingOrphanedBlobs);

        await expect(manager.hardDelete(testActor({ id: 'alice' }), 'dir')).rejects.toThrow();

        // The delete and the failed handoff share one transaction, so the rollback leaves the whole subtree in place.
        expect(await ra.get('dir')).toBeDefined();
        expect(await ra.get('f1')).toBeDefined();
    });
});

//----------------------------------------------------------------------------------------------------------------------
