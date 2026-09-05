//----------------------------------------------------------------------------------------------------------------------
// NodeManager.copy — save a copy
//
// Drives the manager directly against a real NodeRA + real ShareRA over in-memory SQLite (zero mocks below the RA
// seam). Save-a-copy: a new file node owned by the CALLER referencing the SAME blob (content-addressed dedup, no move),
// charged to the caller at copy time, independent of the source afterward. The independence case uses a real BlobRA as
// the orphaned-blob collaborator so a source delete exercises real reference counting.
//----------------------------------------------------------------------------------------------------------------------

/* eslint-disable camelcase -- the share seed builds a snake_case DB row (house convention for Kysely inserts) */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

// Models
import { ForbiddenError, NotFoundError, RegulationError } from '@fileshed/core';

// Resource Access
import { BlobRA } from '@server/resource-access/blob/index.ts';
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
    setUserQuota,
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

// A direct grant on `nodeID` for `granteeID`. The only way to give a non-owner a resolvable role on a seeded node
// without standing up the whole share manager.
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

function manager(orphanedBlobs : OrphanedBlobs = noopOrphanedBlobs()) : NodeManager
{
    return new NodeManager(handle, ra, orphanedBlobs, testNodePolicy());
}

async function caught(promise : Promise<unknown>) : Promise<unknown>
{
    return promise.then(() => { throw new Error('expected a rejection'); }, (error : unknown) => error);
}

function violationCodes(error : unknown) : string[]
{
    return error instanceof RegulationError ? error.violations.map((violation) => violation.code) : [];
}

//----------------------------------------------------------------------------------------------------------------------

describe('NodeManager.copy', () =>
{
    it('copies an owned file into an owned folder as a new node referencing the same blob', async () =>
    {
        await ra.insert(folderNode({ id: 'dest', ownerID: 'alice' }));
        await ra.insert(fileNode({ id: 'src', ownerID: 'alice', blobID: 'sha-a', size: 1000, name: 'report.pdf' }));

        const copy = await manager().copy(testActor({ id: 'alice' }), 'src', { parentID: 'dest' });

        expect(copy).toMatchObject({
            type: 'file',
            ownerID: 'alice',
            parentID: 'dest',
            name: 'report.pdf',
            role: 'owner',
        });
        expect(copy.id).not.toBe('src');
        // Same content, no bytes moved: the copy points at the source's blob.
        expect((copy as { blobID : string }).blobID).toBe('sha-a');

        // The source is untouched, and the caller is now charged for both nodes (dedup is invisible to quota).
        expect(await ra.get('src')).toBeDefined();
        expect(await ra.ownedBytes('alice')).toBe(2000);
    });

    it('defaults the copy name to the source name and honors an explicit name', async () =>
    {
        await ra.insert(fileNode({ id: 'src', ownerID: 'alice', blobID: 'sha-a', name: 'original.txt' }));

        const defaulted = await manager().copy(testActor({ id: 'alice' }), 'src', { parentID: null });
        const named = await manager().copy(testActor({ id: 'alice' }), 'src', { parentID: null, name: 'renamed.txt' });

        expect(defaulted.name).toBe('original.txt');
        expect(named.name).toBe('renamed.txt');
    });

    // The whole point of the feature: a viewer of a shared file saves their own copy, charged to THEM.
    it('lets a viewer copy a shared file into their own root, charged to the viewer', async () =>
    {
        await ra.insert(fileNode({ id: 'src', ownerID: 'alice', blobID: 'sha-a', size: 1500 }));
        await seedShare('src', 'bob', 'viewer');

        const copy = await manager().copy(testActor({ id: 'bob' }), 'src', { parentID: null });

        expect(copy).toMatchObject({ type: 'file', ownerID: 'bob', parentID: null, role: 'owner' });
        expect((copy as { blobID : string }).blobID).toBe('sha-a');

        // Bob is charged; Alice's usage is unchanged -- deleting either node stops only that owner's charge.
        expect(await ra.ownedBytes('bob')).toBe(1500);
        expect(await ra.ownedBytes('alice')).toBe(1500);
    });

    // A copy lands a node under the parent, so the parent-edge rule applies: placing into a folder you only view is the
    // cross-owner edge, which requires editor+.
    it('rejects copying into a folder the caller only views', async () =>
    {
        await ra.insert(folderNode({ id: 'shared', ownerID: 'alice' }));
        await seedShare('shared', 'bob', 'viewer');
        await ra.insert(fileNode({ id: 'mine', ownerID: 'bob', blobID: 'sha-a' }));

        const error = await caught(manager().copy(testActor({ id: 'bob' }), 'mine', { parentID: 'shared' }));

        expect(error).toBeInstanceOf(RegulationError);
        expect(violationCodes(error)).toContain('parent.crossOwner');
        // Nothing landed.
        expect(await ra.ownedBytes('bob')).toBe(10);
    });

    it('rejects a copy that would exceed the caller\'s quota, writing no node', async () =>
    {
        await ra.insert(fileNode({ id: 'src', ownerID: 'alice', blobID: 'sha-a', size: 1000 }));
        await setUserQuota(handle.db, 'alice', 1500);

        const error = await caught(manager().copy(testActor({ id: 'alice' }), 'src', { parentID: null }));

        expect(error).toBeInstanceOf(ForbiddenError);
        // The source is the only node Alice owns; the rejected copy added nothing.
        expect(await ra.ownedBytes('alice')).toBe(1000);
    });

    it('admits a copy that lands the caller exactly at their quota limit', async () =>
    {
        await ra.insert(fileNode({ id: 'src', ownerID: 'alice', blobID: 'sha-a', size: 1000 }));
        await setUserQuota(handle.db, 'alice', 2000);

        const copy = await manager().copy(testActor({ id: 'alice' }), 'src', { parentID: null });

        expect(copy.type).toBe('file');
        expect(await ra.ownedBytes('alice')).toBe(2000);
    });

    // A copy is judged against the cap as it stands when the copy runs, not the one the caller signed in under: an
    // admin who tightens a quota has tightened it for the very next copy.
    it('judges a copy against a cap lowered since the caller signed in', async () =>
    {
        await ra.insert(fileNode({ id: 'src', ownerID: 'alice', blobID: 'sha-a', size: 1000 }));
        await setUserQuota(handle.db, 'alice', 10_000);

        const actor = testActor({ id: 'alice' });
        await setUserQuota(handle.db, 'alice', 1500);

        expect(await caught(manager().copy(actor, 'src', { parentID: null }))).toBeInstanceOf(ForbiddenError);
        expect(await ra.ownedBytes('alice')).toBe(1000);
    });

    // The reverse direction, so the live read is not mistaken for "always refuse": a raised cap admits the very next
    // copy, with no session turnover in between.
    it('admits a copy under a cap raised since the caller signed in', async () =>
    {
        await ra.insert(fileNode({ id: 'src', ownerID: 'alice', blobID: 'sha-a', size: 1000 }));
        await setUserQuota(handle.db, 'alice', 1500);

        const actor = testActor({ id: 'alice' });
        await setUserQuota(handle.db, 'alice', 2000);

        await manager().copy(actor, 'src', { parentID: null });

        expect(await ra.ownedBytes('alice')).toBe(2000);
    });

    // The copy path charges the same quota the upload path does, so it must resolve the instance default the same
    // way: an account with no limit of its own is bound by whatever the default currently says.
    it('rejects a copy that would exceed the instance default for an account with no limit of its own', async () =>
    {
        await ra.insert(fileNode({ id: 'src', ownerID: 'alice', blobID: 'sha-a', size: 1000 }));

        const bound = new NodeManager(handle, ra, noopOrphanedBlobs(), { defaultQuota: async () => 1500 });
        const error = await caught(bound.copy(testActor({ id: 'alice' }), 'src', { parentID: null }));

        expect(error).toBeInstanceOf(ForbiddenError);
        expect(await ra.ownedBytes('alice')).toBe(1000);
    });

    it('admits that same copy for an account explicitly pinned unlimited', async () =>
    {
        await ra.insert(fileNode({ id: 'src', ownerID: 'alice', blobID: 'sha-a', size: 1000 }));

        await setUserQuota(handle.db, 'alice', 0);

        const bound = new NodeManager(handle, ra, noopOrphanedBlobs(), { defaultQuota: async () => 1500 });
        await bound.copy(testActor({ id: 'alice' }), 'src', { parentID: null });

        expect(await ra.ownedBytes('alice')).toBe(2000);
    });

    it('rejects copying a folder', async () =>
    {
        await ra.insert(folderNode({ id: 'dir', ownerID: 'alice' }));

        const error = await caught(manager().copy(testActor({ id: 'alice' }), 'dir', { parentID: null }));

        expect(error).toBeInstanceOf(RegulationError);
        expect(violationCodes(error)).toEqual([ 'copy.sourceNotFile' ]);
    });

    it('rejects copying a link', async () =>
    {
        await ra.insert(folderNode({ id: 'target', ownerID: 'alice' }));
        await ra.insert(linkNode({ id: 'lnk', ownerID: 'alice', targetNodeID: 'target' }));

        const error = await caught(manager().copy(testActor({ id: 'alice' }), 'lnk', { parentID: null }));

        expect(error).toBeInstanceOf(RegulationError);
        expect(violationCodes(error)).toEqual([ 'copy.sourceNotFile' ]);
    });

    // A source the caller cannot resolve reads as absent -- a 404 that never confirms the file exists.
    it('returns not-found when the caller cannot resolve the source', async () =>
    {
        await ra.insert(fileNode({ id: 'src', ownerID: 'alice', blobID: 'sha-a' }));

        const error = await caught(manager().copy(testActor({ id: 'carol' }), 'src', { parentID: null }));

        expect(error).toBeInstanceOf(NotFoundError);
    });

    // The owner can already download trashed bytes and re-claim them into a live node, so the direct copy is legal
    // too: the copy lands live, the source stays exactly where it was -- in the trash.
    it('lets the owner copy their own trashed file, leaving the source trashed', async () =>
    {
        await ra.insert(fileNode({ id: 'src', ownerID: 'alice', blobID: 'sha-a', trashedAt: new Date() }));

        const copy = await manager().copy(testActor({ id: 'alice' }), 'src', { parentID: null });

        expect(copy).toMatchObject({ type: 'file', ownerID: 'alice', role: 'owner' });
        expect(copy.type === 'file' ? copy.trashedAt : undefined).toBeNull();

        const source = await handle.db.selectFrom('node').select('trashed_at')
            .where('id', '=', 'src')
            .executeTakeFirstOrThrow();
        expect(source.trashed_at).not.toBeNull();
    });

    // Trash hides a node from recipients; a grant resolves a role regardless of trash state, so the guard -- not the
    // resolver -- is what keeps a trashed source absent for everyone but its owner.
    it('treats a trashed source as absent for a viewer holding a grant on it', async () =>
    {
        await ra.insert(fileNode({ id: 'src', ownerID: 'alice', blobID: 'sha-a', trashedAt: new Date() }));
        await seedShare('src', 'bob', 'viewer');

        const error = await caught(manager().copy(testActor({ id: 'bob' }), 'src', { parentID: null }));

        expect(error).toBeInstanceOf(NotFoundError);
    });

    // Independence: once made, the copy outlives the source. Deleting the source leaves the blob live because the copy
    // still references it -- real reference counting through a real BlobRA, not a double.
    it('keeps the copy and its blob alive after the source is hard-deleted', async () =>
    {
        await ra.insert(fileNode({ id: 'src', ownerID: 'alice', blobID: 'sha-a', size: 1000 }));
        await seedShare('src', 'bob', 'viewer');

        const mgr = manager(new BlobRA(handle));
        const copy = await mgr.copy(testActor({ id: 'bob' }), 'src', { parentID: null });

        await mgr.hardDelete(testActor({ id: 'alice' }), 'src');

        // The source is gone, the copy remains, and the blob is not graveyarded -- the copy still references it.
        expect(await ra.get('src')).toBeUndefined();
        expect(await ra.get(copy.id)).toBeDefined();

        const blob = await handle.db
            .selectFrom('blob')
            .select('deleted_at')
            .where('sha256', '=', 'sha-a')
            .executeTakeFirstOrThrow();
        expect(blob.deleted_at).toBeNull();
    });
});

//----------------------------------------------------------------------------------------------------------------------
