//----------------------------------------------------------------------------------------------------------------------
// Trash Auto-Purge — runTrashPurgeOnce
//
// Drives the sweep against a real NodeRA and a real BlobRA (as the graveyard collaborator) over in-memory SQLite, zero
// mocks below the RA seam, real FK cascades. A trashed subtree past its grace window is deleted whole and its now-
// unreferenced blobs graveyarded; an unexpired or untrashed subtree is left alone; a nested trashed folder is never
// processed as its own candidate; one failing root does not abort the batch.
//----------------------------------------------------------------------------------------------------------------------

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

// Resource Access
import { BlobRA } from '@server/resource-access/blob/index.ts';
import type { DatabaseHandle } from '@server/resource-access/database/database.ts';
import { NodeRA } from '@server/resource-access/nodes/node.ts';

// Managers
import { NodeManager } from '@server/managers/node.ts';
import { type TrashRootPurger, runTrashPurgeOnce } from '@server/managers/trashPurge.ts';

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

//----------------------------------------------------------------------------------------------------------------------

const GRACE_MS = 30 * 24 * 60 * 60 * 1000;

// Comfortably older than any cutoff GRACE_MS produces -- a trashed_at the sweep must treat as lapsed.
const EXPIRED = new Date('2020-01-01T00:00:00.000Z');

let handle : DatabaseHandle;
let ra : NodeRA;
let nodes : NodeManager;

beforeEach(async () =>
{
    handle = await createTestDatabase();
    ra = new NodeRA(handle);
    nodes = new NodeManager(handle, ra, new BlobRA(handle));

    await seedUser(handle.db, 'alice');
    await seedUser(handle.db, 'bob');
    await seedBackend(handle.db, 'be1');
    await seedBlob(handle.db, 'sha-a', 'be1');
    await seedBlob(handle.db, 'sha-b', 'be1');
});

afterEach(async () =>
{
    await handle.db.destroy();
});

//----------------------------------------------------------------------------------------------------------------------

async function blobDeletedAt(sha256 : string) : Promise<string | Date | null>
{
    const row = await handle.db.selectFrom('blob').select('deleted_at')
        .where('sha256', '=', sha256)
        .executeTakeFirstOrThrow();
    return row.deleted_at;
}

//----------------------------------------------------------------------------------------------------------------------

describe('runTrashPurgeOnce', () =>
{
    // A whole expired trashed subtree -- the root, its file, a nested subfolder, and that folder's file -- is deleted
    // as a unit and both files' blobs graveyarded. The live folder the subtree hangs under is untouched. Only the
    // subtree root counts as a candidate: the nested folder's parent is trashed, so it is not selected on its own.
    it('purges an expired trashed subtree whole and graveyards its blobs, counting only the root', async () =>
    {
        await ra.insert(folderNode({ id: 'home', ownerID: 'alice' }));
        await ra.insert(folderNode({ id: 'dir', ownerID: 'alice', parentID: 'home', trashedAt: EXPIRED }));
        await ra.insert(fileNode({ id: 'f1', ownerID: 'alice', parentID: 'dir', blobID: 'sha-a', trashedAt: EXPIRED }));
        await ra.insert(folderNode({ id: 'sub', ownerID: 'alice', parentID: 'dir', trashedAt: EXPIRED }));
        await ra.insert(fileNode({ id: 'f2', ownerID: 'alice', parentID: 'sub', blobID: 'sha-b', trashedAt: EXPIRED }));

        const summary = await runTrashPurgeOnce({ nodes: ra, purger: nodes, graceMs: GRACE_MS });

        expect(summary).toEqual({ candidates: 1, purged: 1, failed: 0 });

        expect(await ra.get('dir')).toBeUndefined();
        expect(await ra.get('f1')).toBeUndefined();
        expect(await ra.get('sub')).toBeUndefined();
        expect(await ra.get('f2')).toBeUndefined();
        expect(await ra.get('home')).toBeDefined();

        expect(await blobDeletedAt('sha-a')).not.toBeNull();
        expect(await blobDeletedAt('sha-b')).not.toBeNull();
    });

    // A root-level trashed item (parent_id null) is a candidate too -- the "no parent" case of "parent not trashed".
    it('purges a root-level trashed item whose grace window has lapsed', async () =>
    {
        await ra.insert(fileNode({ id: 'solo', ownerID: 'alice', blobID: 'sha-a', trashedAt: EXPIRED }));

        const summary = await runTrashPurgeOnce({ nodes: ra, purger: nodes, graceMs: GRACE_MS });

        expect(summary).toEqual({ candidates: 1, purged: 1, failed: 0 });
        expect(await ra.get('solo')).toBeUndefined();
    });

    it('leaves a trashed item still inside its grace window untouched', async () =>
    {
        const now = new Date();
        await ra.insert(folderNode({ id: 'fresh', ownerID: 'alice', trashedAt: now }));
        await ra.insert(fileNode({ id: 'f1', ownerID: 'alice', parentID: 'fresh', blobID: 'sha-a', trashedAt: now }));

        const summary = await runTrashPurgeOnce({ nodes: ra, purger: nodes, graceMs: GRACE_MS });

        expect(summary).toEqual({ candidates: 0, purged: 0, failed: 0 });
        expect(await ra.get('fresh')).toBeDefined();
        expect(await ra.get('f1')).toBeDefined();
        expect(await blobDeletedAt('sha-a')).toBeNull();
    });

    it('leaves an untrashed subtree untouched', async () =>
    {
        await ra.insert(folderNode({ id: 'live', ownerID: 'alice' }));
        await ra.insert(fileNode({ id: 'f1', ownerID: 'alice', parentID: 'live', blobID: 'sha-a' }));

        const summary = await runTrashPurgeOnce({ nodes: ra, purger: nodes, graceMs: GRACE_MS });

        expect(summary).toEqual({ candidates: 0, purged: 0, failed: 0 });
        expect(await ra.get('live')).toBeDefined();
        expect(await ra.get('f1')).toBeDefined();
    });

    // A link pointing into a purged subtree dies with its target by FK cascade -- the same permanent death a manual
    // hard delete produces. The link lives in another user's live tree and is never itself a candidate (links carry no
    // trashed_at); it goes only because its target does.
    it('removes links pointing into a purged subtree by cascade', async () =>
    {
        await ra.insert(folderNode({ id: 'dir', ownerID: 'alice', trashedAt: EXPIRED }));
        await ra.insert(fileNode({ id: 'f1', ownerID: 'alice', parentID: 'dir', blobID: 'sha-a', trashedAt: EXPIRED }));
        await ra.insert(linkNode({ id: 'lnk', ownerID: 'bob', targetNodeID: 'f1' }));

        const summary = await runTrashPurgeOnce({ nodes: ra, purger: nodes, graceMs: GRACE_MS });

        expect(summary).toEqual({ candidates: 1, purged: 1, failed: 0 });
        expect(await ra.get('f1')).toBeUndefined();
        expect(await ra.get('lnk')).toBeUndefined();
    });

    // One root whose purge throws is logged and counted, never rethrown: the other expired root still purges and the
    // summary reports the failure honestly rather than the whole sweep aborting.
    it('isolates a failing root, purging the rest and counting the failure', async () =>
    {
        await ra.insert(folderNode({ id: 'alpha', ownerID: 'alice', trashedAt: EXPIRED }));
        await ra.insert(folderNode({ id: 'beta', ownerID: 'alice', trashedAt: EXPIRED }));

        const purger : TrashRootPurger = {
            async purgeTrashedRoot(rootID : string) : Promise<void>
            {
                if(rootID === 'beta') { throw new Error('simulated purge failure'); }
                await nodes.purgeTrashedRoot(rootID);
            },
        };

        const summary = await runTrashPurgeOnce({ nodes: ra, purger, graceMs: GRACE_MS });

        expect(summary).toEqual({ candidates: 2, purged: 1, failed: 1 });
        expect(await ra.get('alpha')).toBeUndefined();
        expect(await ra.get('beta')).toBeDefined();
    });
});

//----------------------------------------------------------------------------------------------------------------------
