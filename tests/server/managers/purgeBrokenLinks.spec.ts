//----------------------------------------------------------------------------------------------------------------------
// NodeManager.purgeBrokenLinks — broken-link cleanup
//
// Drives the manager directly against a real NodeRA + real ShareRA over in-memory SQLite (zero mocks below the RA
// seam, real FK enforcement). "Dead" is derived at purge time -- the caller cannot resolve the link's target -- never a
// stored flag; the purge removes only the caller's OWN dead links in the folder, so a contributor's links in a shared
// folder are never destroyed by another user's cleanup.
//----------------------------------------------------------------------------------------------------------------------

/* eslint-disable camelcase -- the share seed and state reads name snake_case DB columns (house convention) */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

// Models
import { NotFoundError } from '@fileshed/core';

// Resource Access
import type { DatabaseHandle } from '@server/resource-access/database/database.ts';
import { NodeRA } from '@server/resource-access/nodes/node.ts';

// Managers
import { NodeManager } from '@server/managers/node.ts';

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
import { noopOrphanedBlobs, testActor, testNodePolicy } from '../nodes/support.ts';

//----------------------------------------------------------------------------------------------------------------------

let handle : DatabaseHandle;
let ra : NodeRA;

beforeEach(async () =>
{
    handle = await createTestDatabase();
    ra = new NodeRA(handle);

    await seedUser(handle.db, 'alice');
    await seedUser(handle.db, 'bob');
    await seedUser(handle.db, 'carol');
    await seedBackend(handle.db, 'be1');
    await seedBlob(handle.db, 'sha-a', 'be1');
});

afterEach(async () =>
{
    await handle.db.destroy();
});

//----------------------------------------------------------------------------------------------------------------------

async function seedShare(nodeID : string, granteeID : string, role : 'viewer' | 'editor') : Promise<void>
{
    await handle.db
        .insertInto('share')
        .values({
            id: `share_${ nodeID }_${ granteeID }`,
            node_id: nodeID,
            grantee_user_id: granteeID,
            role,
            created_by: 'alice',
            created_at: new Date().toISOString(),
        })
        .execute();
}

async function childIDs(parentID : string) : Promise<string[]>
{
    const rows = await handle.db
        .selectFrom('node')
        .select('id')
        .where('parent_id', '=', parentID)
        .orderBy('id', 'asc')
        .execute();

    return rows.map((row) => row.id);
}

function manager() : NodeManager
{
    return new NodeManager(handle, ra, noopOrphanedBlobs(), testNodePolicy());
}

async function caught(promise : Promise<unknown>) : Promise<unknown>
{
    return promise.then(() => { throw new Error('expected a rejection'); }, (error : unknown) => error);
}

//----------------------------------------------------------------------------------------------------------------------

describe('NodeManager.purgeBrokenLinks', () =>
{
    // The mainline: a folder holds one link the caller resolves and one they cannot, plus a plain file. The dead link
    // goes; the live link, the file, and the dead link's target all remain.
    it('removes the caller\'s dead links, leaving live links, files, and the dead targets', async () =>
    {
        await ra.insert(folderNode({ id: 'dir', ownerID: 'alice' }));
        await ra.insert(folderNode({ id: 'visible', ownerID: 'alice' }));
        await ra.insert(folderNode({ id: 'foreign', ownerID: 'bob' }));
        await ra.insert(linkNode({ id: 'liveLink', ownerID: 'alice', parentID: 'dir', targetNodeID: 'visible' }));
        await ra.insert(linkNode({ id: 'deadLink', ownerID: 'alice', parentID: 'dir', targetNodeID: 'foreign' }));
        await ra.insert(fileNode({ id: 'keep', ownerID: 'alice', parentID: 'dir', blobID: 'sha-a' }));

        const result = await manager().purgeBrokenLinks(testActor({ id: 'alice' }), 'dir');

        expect(result).toEqual({ purged: 1 });
        expect(await ra.get('deadLink')).toBeUndefined();
        // The live link and the non-link child survive; deleting a link never touches its target.
        expect(await childIDs('dir')).toEqual([ 'keep', 'liveLink' ]);
        expect(await ra.get('foreign')).toBeDefined();
    });

    it('reports zero when every link in the folder still resolves', async () =>
    {
        await ra.insert(folderNode({ id: 'dir', ownerID: 'alice' }));
        await ra.insert(folderNode({ id: 'visible', ownerID: 'alice' }));
        await ra.insert(linkNode({ id: 'liveLink', ownerID: 'alice', parentID: 'dir', targetNodeID: 'visible' }));
        await ra.insert(fileNode({ id: 'keep', ownerID: 'alice', parentID: 'dir', blobID: 'sha-a' }));

        const result = await manager().purgeBrokenLinks(testActor({ id: 'alice' }), 'dir');

        expect(result).toEqual({ purged: 0 });
        expect(await childIDs('dir')).toEqual([ 'keep', 'liveLink' ]);
    });

    it('reports zero for an empty folder', async () =>
    {
        await ra.insert(folderNode({ id: 'dir', ownerID: 'alice' }));

        const result = await manager().purgeBrokenLinks(testActor({ id: 'alice' }), 'dir');

        expect(result).toEqual({ purged: 0 });
    });

    // Authority is read access to the folder: one the caller cannot resolve reads as absent, never confirming it.
    it('returns not-found for a folder the caller cannot resolve', async () =>
    {
        await ra.insert(folderNode({ id: 'dir', ownerID: 'bob' }));
        await ra.insert(folderNode({ id: 'foreign', ownerID: 'carol' }));
        await ra.insert(linkNode({ id: 'bobLink', ownerID: 'bob', parentID: 'dir', targetNodeID: 'foreign' }));

        const error = await caught(manager().purgeBrokenLinks(testActor({ id: 'alice' }), 'dir'));

        expect(error).toBeInstanceOf(NotFoundError);
        // Nothing was touched.
        expect(await ra.get('bobLink')).toBeDefined();
    });

    // The folder owner's cleanup prunes only their own placements: a contributor's dead link -- dead even when resolved
    // as the owner -- survives, because it is not the owner's to remove.
    it('leaves a contributor\'s dead links untouched when the folder owner purges', async () =>
    {
        await ra.insert(folderNode({ id: 'dir', ownerID: 'alice' }));
        await seedShare('dir', 'bob', 'editor');
        await ra.insert(folderNode({ id: 'foreign', ownerID: 'carol' }));
        await ra.insert(linkNode({ id: 'aliceDead', ownerID: 'alice', parentID: 'dir', targetNodeID: 'foreign' }));
        await ra.insert(linkNode({ id: 'bobDead', ownerID: 'bob', parentID: 'dir', targetNodeID: 'foreign' }));

        const result = await manager().purgeBrokenLinks(testActor({ id: 'alice' }), 'dir');

        expect(result).toEqual({ purged: 1 });
        expect(await ra.get('aliceDead')).toBeUndefined();
        expect(await ra.get('bobDead')).toBeDefined();
    });

    // The other side of the same rule: a contributor cleaning up a folder shared to them prunes their own dead links
    // and leaves the owner's alone.
    it('lets an editor purge only their own dead links in a folder shared to them', async () =>
    {
        await ra.insert(folderNode({ id: 'dir', ownerID: 'alice' }));
        await seedShare('dir', 'bob', 'editor');
        await ra.insert(folderNode({ id: 'foreign', ownerID: 'carol' }));
        await ra.insert(linkNode({ id: 'aliceDead', ownerID: 'alice', parentID: 'dir', targetNodeID: 'foreign' }));
        await ra.insert(linkNode({ id: 'bobDead', ownerID: 'bob', parentID: 'dir', targetNodeID: 'foreign' }));

        const result = await manager().purgeBrokenLinks(testActor({ id: 'bob' }), 'dir');

        expect(result).toEqual({ purged: 1 });
        expect(await ra.get('bobDead')).toBeUndefined();
        expect(await ra.get('aliceDead')).toBeDefined();
    });

    // A link whose target the caller resolves through a share is live -- a transient revocation that later heals must
    // not have destroyed the placement in the meantime, so only genuinely unresolvable links are purged.
    it('keeps a link whose target the caller resolves through a share', async () =>
    {
        await ra.insert(folderNode({ id: 'dir', ownerID: 'alice' }));
        await ra.insert(fileNode({ id: 'shared', ownerID: 'bob', blobID: 'sha-a' }));
        await seedShare('shared', 'alice', 'viewer');
        await ra.insert(linkNode({ id: 'sharedLink', ownerID: 'alice', parentID: 'dir', targetNodeID: 'shared' }));

        const result = await manager().purgeBrokenLinks(testActor({ id: 'alice' }), 'dir');

        expect(result).toEqual({ purged: 0 });
        expect(await ra.get('sharedLink')).toBeDefined();
    });
});

//----------------------------------------------------------------------------------------------------------------------
