//----------------------------------------------------------------------------------------------------------------------
// ShareManager.sharedWithMe — Type and Modified filters
//
// Drives the manager directly against real Node/Share/User RAs over in-memory SQLite (zero mocks below the RA seam).
// The behavior under test: the caller's shared-with-me listing narrows to the target's own type family and its
// last-modified window, with the same Type and Modified semantics the drive listing applies, and the cross-user scoping
// the listing already guarantees survives every filter -- a filter never widens the set to another grantee's shares.
//----------------------------------------------------------------------------------------------------------------------

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { Share, SharedWithMeQuery } from '@fileshed/core';

// Resource Access
import type { DatabaseHandle } from '@server/resource-access/database/database.ts';
import { NodeRA } from '@server/resource-access/nodes/node.ts';
import { ShareRA } from '@server/resource-access/shares/index.ts';
import { UserRA } from '@server/resource-access/users/index.ts';

// Managers
import { ShareManager } from '@server/managers/share.ts';

// Support
import { createTestDatabase, fileNode, folderNode, seedBackend, seedBlob, seedUser } from
    '../resource-access/nodes/support.ts';
import { testActor } from '../nodes/support.ts';

//----------------------------------------------------------------------------------------------------------------------

let handle : DatabaseHandle;
let shares : ShareRA;
let manager : ShareManager;

const createdAt = new Date('2026-02-01T00:00:00.000Z');
const grantee = testActor({ id: 'grantee' });

beforeEach(async () =>
{
    handle = await createTestDatabase();
    const nodes = new NodeRA(handle);
    shares = new ShareRA(handle);
    manager = new ShareManager(handle, nodes, shares, new UserRA(handle));

    await seedUser(handle.db, 'owner');
    await seedUser(handle.db, 'grantee');
    await seedUser(handle.db, 'other');
    await seedBackend(handle.db, 'be1');
    await seedBlob(handle.db, 'sha-a', 'be1');
});

afterEach(async () =>
{
    await handle.db.destroy();
});

function share(id : string, nodeID : string, granteeID : string) : Share
{
    return { id, nodeID, granteeUserID: granteeID, role: 'viewer', createdBy: 'owner', createdAt };
}

const unfiltered : SharedWithMeQuery = { types: [] };

async function sharedIDs(query : SharedWithMeQuery) : Promise<string[]>
{
    const { entries } = await manager.sharedWithMe(grantee, query);
    return entries.map((entry) => entry.target.id);
}

//----------------------------------------------------------------------------------------------------------------------

describe('ShareManager.sharedWithMe — Type filter', () =>
{
    beforeEach(async () =>
    {
        const nodes = new NodeRA(handle);
        await nodes.insert(fileNode({ id: 'pic', ownerID: 'owner', blobID: 'sha-a', mimeType: 'image/png' }));
        await nodes.insert(fileNode({ id: 'doc', ownerID: 'owner', blobID: 'sha-a', mimeType: 'application/pdf' }));
        await nodes.insert(folderNode({ id: 'dir', ownerID: 'owner' }));
        await shares.upsertShare(share('s-pic', 'pic', 'grantee'));
        await shares.upsertShare(share('s-doc', 'doc', 'grantee'));
        await shares.upsertShare(share('s-dir', 'dir', 'grantee'));
    });

    it('returns every active share when no type family is selected', async () =>
    {
        expect((await sharedIDs(unfiltered)).sort()).toEqual([ 'dir', 'doc', 'pic' ]);
    });

    it('narrows to a chosen mime family, classifying the target the way the drive does', async () =>
    {
        expect(await sharedIDs({ types: [ 'images' ] })).toEqual([ 'pic' ]);
    });

    it('selects a folder target only under the folders family', async () =>
    {
        expect(await sharedIDs({ types: [ 'folders' ] })).toEqual([ 'dir' ]);
    });

    it('ORs multiple selected families together', async () =>
    {
        expect((await sharedIDs({ types: [ 'images', 'pdfs' ] })).sort()).toEqual([ 'doc', 'pic' ]);
    });
});

//----------------------------------------------------------------------------------------------------------------------

describe('ShareManager.sharedWithMe — Modified filter', () =>
{
    beforeEach(async () =>
    {
        const nodes = new NodeRA(handle);
        await nodes.insert(fileNode({ id: 'old',
            ownerID: 'owner',
            blobID: 'sha-a',
            updatedAt: new Date('2026-01-10T00:00:00.000Z') }));
        await nodes.insert(fileNode({ id: 'mid',
            ownerID: 'owner',
            blobID: 'sha-a',
            updatedAt: new Date('2026-02-10T00:00:00.000Z') }));
        await nodes.insert(fileNode({ id: 'new',
            ownerID: 'owner',
            blobID: 'sha-a',
            updatedAt: new Date('2026-03-10T00:00:00.000Z') }));
        await shares.upsertShare(share('s-old', 'old', 'grantee'));
        await shares.upsertShare(share('s-mid', 'mid', 'grantee'));
        await shares.upsertShare(share('s-new', 'new', 'grantee'));
    });

    it('keeps only targets in the half-open window: updatedAfter inclusive, updatedBefore exclusive', async () =>
    {
        const window : SharedWithMeQuery = {
            types: [],
            updatedAfter: '2026-02-10T00:00:00.000Z',
            updatedBefore: '2026-03-10T00:00:00.000Z',
        };

        // The lower bound is inclusive (mid, at exactly updatedAfter, stays); the upper bound is exclusive (new, at
        // exactly updatedBefore, drops).
        expect(await sharedIDs(window)).toEqual([ 'mid' ]);
    });

    it('keeps only targets modified on or after a lower bound', async () =>
    {
        expect((await sharedIDs({ types: [], updatedAfter: '2026-02-01T00:00:00.000Z' })).sort())
            .toEqual([ 'mid', 'new' ]);
    });
});

//----------------------------------------------------------------------------------------------------------------------

describe('ShareManager.sharedWithMe — cross-user scoping under filters', () =>
{
    it('never surfaces another grantee\'s matching share, filtered or not', async () =>
    {
        const nodes = new NodeRA(handle);
        await nodes.insert(fileNode({ id: 'mine', ownerID: 'owner', blobID: 'sha-a', mimeType: 'image/png' }));
        await nodes.insert(fileNode({ id: 'theirs', ownerID: 'owner', blobID: 'sha-a', mimeType: 'image/png' }));
        await shares.upsertShare(share('s-mine', 'mine', 'grantee'));
        await shares.upsertShare(share('s-theirs', 'theirs', 'other'));

        expect(await sharedIDs({ types: [ 'images' ] })).toEqual([ 'mine' ]);
        expect(await sharedIDs(unfiltered)).toEqual([ 'mine' ]);
    });
});

//----------------------------------------------------------------------------------------------------------------------
