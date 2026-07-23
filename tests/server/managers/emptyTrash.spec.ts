//----------------------------------------------------------------------------------------------------------------------
// NodeManager.emptyTrash — permanently empty the caller's trash
//
// Drives the manager directly against a real NodeRA + real BlobRA over in-memory SQLite (zero mocks below the RA seam,
// real FK cascades) -- the same collaborators the trash auto-purge sweep uses. emptyTrash purges each of the caller's
// trashed roots through purgeTrashedRoot, the identical subtree-delete + blob-graveyard path a single permanent delete
// takes, so the two can never drift apart. Scoped to the caller: another user's trash is never touched. An empty
// trash purges nothing and reports zero.
//----------------------------------------------------------------------------------------------------------------------

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

// Resource Access
import { BlobRA } from '@server/resource-access/blob/index.ts';
import type { DatabaseHandle } from '@server/resource-access/database/database.ts';
import { NodeRA } from '@server/resource-access/nodes/node.ts';

// Managers
import { NodeManager } from '@server/managers/node.ts';

// Support
import {
    createTestDatabase,
    fileNode,
    folderNode,
    seedBackend,
    seedBlob,
    seedUser,
} from '../resource-access/nodes/support.ts';
import { testActor } from '../nodes/support.ts';

//----------------------------------------------------------------------------------------------------------------------

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

describe('NodeManager.emptyTrash', () =>
{
    it('purges every trashed root whole and graveyards its blobs, reporting the root count', async () =>
    {
        await ra.insert(folderNode({ id: 'dir', ownerID: 'alice' }));
        await ra.insert(fileNode({ id: 'f1', ownerID: 'alice', parentID: 'dir', blobID: 'sha-a' }));
        await ra.insert(fileNode({ id: 'solo', ownerID: 'alice', blobID: 'sha-b' }));
        await ra.setTrashed('dir', new Date());
        await ra.setTrashed('solo', new Date());

        const result = await nodes.emptyTrash(testActor({ id: 'alice' }));

        expect(result).toEqual({ purged: 2 });
        expect(await ra.get('dir')).toBeUndefined();
        expect(await ra.get('f1')).toBeUndefined();
        expect(await ra.get('solo')).toBeUndefined();
        expect(await blobDeletedAt('sha-a')).not.toBeNull();
        expect(await blobDeletedAt('sha-b')).not.toBeNull();
    });

    it('leaves an untrashed subtree alone -- only trashed roots are counted and purged', async () =>
    {
        await ra.insert(folderNode({ id: 'live', ownerID: 'alice' }));
        await ra.insert(fileNode({ id: 'f1', ownerID: 'alice', parentID: 'live', blobID: 'sha-a' }));

        const result = await nodes.emptyTrash(testActor({ id: 'alice' }));

        expect(result).toEqual({ purged: 0 });
        expect(await ra.get('live')).toBeDefined();
        expect(await ra.get('f1')).toBeDefined();
        expect(await blobDeletedAt('sha-a')).toBeNull();
    });

    it('is a harmless no-op when the caller has nothing trashed', async () =>
    {
        const result = await nodes.emptyTrash(testActor({ id: 'alice' }));

        expect(result).toEqual({ purged: 0 });
    });

    it('empties only the caller\'s trash, leaving another user\'s trashed roots untouched', async () =>
    {
        await ra.insert(folderNode({ id: 'aliceTrash', ownerID: 'alice' }));
        await ra.insert(folderNode({ id: 'bobTrash', ownerID: 'bob' }));
        await ra.setTrashed('aliceTrash', new Date());
        await ra.setTrashed('bobTrash', new Date());

        const result = await nodes.emptyTrash(testActor({ id: 'alice' }));

        expect(result).toEqual({ purged: 1 });
        expect(await ra.get('aliceTrash')).toBeUndefined();
        expect(await ra.get('bobTrash')).toBeDefined();
    });

    // A nested trashed folder's subtree purges as a unit through the same root-only selection the trash listing and
    // the auto-purge sweep both use -- a descendant trashed alongside its root never double-counts as its own root.
    it('purges a trashed folder\'s whole subtree once, not once per nested trashed descendant', async () =>
    {
        await ra.insert(folderNode({ id: 'dir', ownerID: 'alice' }));
        await ra.insert(folderNode({ id: 'sub', ownerID: 'alice', parentID: 'dir' }));
        await ra.insert(fileNode({ id: 'f1', ownerID: 'alice', parentID: 'sub', blobID: 'sha-a' }));
        await ra.setTrashed('dir', new Date());

        const result = await nodes.emptyTrash(testActor({ id: 'alice' }));

        expect(result).toEqual({ purged: 1 });
        expect(await ra.get('sub')).toBeUndefined();
        expect(await ra.get('f1')).toBeUndefined();
    });
});

//----------------------------------------------------------------------------------------------------------------------
