//----------------------------------------------------------------------------------------------------------------------
// NodeManager — logic the HTTP surface can't cleanly show
//
// Drives the manager directly against a real NodeRA over in-memory SQLite (zero mocks below the RA seam), with only the
// blob-graveyard collaborator as a recording double. Covers what the route specs can't stage without the upload flow:
// quota usage over seeded file nodes, and the orphaned-blob handoff a hard delete performs.
//----------------------------------------------------------------------------------------------------------------------

/* eslint-disable camelcase -- the share seed builds a snake_case DB row (house convention for Kysely inserts) */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

// Models
import { NotFoundError } from '@fileshed/core';

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

    // The client renders retention copy from this value, so it must be the deployment's configured number -- never a
    // shipped default a deployment has overridden.
    it('reports the configured trash retention, not the shipped default', async () =>
    {
        const manager = new NodeManager(handle, ra, noopOrphanedBlobs(), undefined, async () => 2);
        const me = await manager.me(testActor({ id: 'alice' }));

        expect(me.limits).toEqual({ trashRetentionDays: 2 });
    });

    it('falls back to the default trash retention when none is configured', async () =>
    {
        const manager = new NodeManager(handle, ra, noopOrphanedBlobs());
        const me = await manager.me(testActor({ id: 'alice' }));

        expect(me.limits).toEqual({ trashRetentionDays: 30 });
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

describe('NodeManager trashed visibility', () =>
{
    // A live grant on a trashed folder still resolves a role -- the resolver deliberately ignores trash state -- so
    // the manager guard is the single place recipients lose sight of trashed items, while the owner keeps their
    // trash readable.
    async function seedTrashedSharedFolder() : Promise<void>
    {
        await seedUser(handle.db, 'bob');
        await ra.insert(folderNode({ id: 'dir', ownerID: 'alice', trashedAt: new Date() }));
        await handle.db.insertInto('share').values({
            id: 'share_dir_bob',
            node_id: 'dir',
            grantee_user_id: 'bob',
            role: 'viewer',
            created_by: 'alice',
            created_at: new Date().toISOString(),
        })
            .execute();
    }

    it('reads a trashed shared folder as absent for the recipient, but not for its owner', async () =>
    {
        await seedTrashedSharedFolder();
        const manager = new NodeManager(handle, ra, noopOrphanedBlobs());

        await expect(manager.get(testActor({ id: 'bob' }), 'dir')).rejects.toThrow(NotFoundError);

        const owned = await manager.get(testActor({ id: 'alice' }), 'dir');
        expect(owned).toMatchObject({ id: 'dir', role: 'owner' });
    });

    it('lists a trashed folder\'s children only for its owner', async () =>
    {
        await seedTrashedSharedFolder();
        const manager = new NodeManager(handle, ra, noopOrphanedBlobs());
        const query = { limit: 50, offset: 0, sortKey: 'name', sortDirection: 'asc', types: [] } as const;

        await expect(manager.children(testActor({ id: 'bob' }), 'dir', query)).rejects.toThrow(NotFoundError);
        await expect(manager.children(testActor({ id: 'alice' }), 'dir', query)).resolves.toBeDefined();
    });
});

//----------------------------------------------------------------------------------------------------------------------

describe('NodeManager.children owner facet', () =>
{
    // The owner facet the listing response carries must be the folder's whole set of owners, so the owner filter menu
    // can always switch owners -- even while an owner filter has narrowed the page down to one of them.
    it('carries every folder owner in the facet, unnarrowed by an active owner filter', async () =>
    {
        await seedUser(handle.db, 'bob');
        await ra.insert(folderNode({ id: 'p', ownerID: 'alice' }));
        await ra.insert(fileNode({ id: 'mine', ownerID: 'alice', blobID: 'sha-a', parentID: 'p' }));
        await ra.insert(fileNode({ id: 'theirs', ownerID: 'bob', blobID: 'sha-a', parentID: 'p' }));

        const manager = new NodeManager(handle, ra, noopOrphanedBlobs());
        const base = { limit: 50, offset: 0, sortKey: 'name', sortDirection: 'asc', types: [] } as const;

        const unfiltered = await manager.children(testActor({ id: 'alice' }), 'p', base);
        const byBob = await manager.children(testActor({ id: 'alice' }), 'p', { ...base, ownerID: 'bob' });

        // The facet lists both owners in both calls.
        expect(new Set(unfiltered.owners.map((owner) => owner.id))).toEqual(new Set([ 'alice', 'bob' ]));
        expect(new Set(byBob.owners.map((owner) => owner.id))).toEqual(new Set([ 'alice', 'bob' ]));

        // But the owner filter narrows the page itself to bob's contribution.
        expect(byBob.nodes.map((node) => node.id)).toEqual([ 'theirs' ]);
        expect(byBob.total).toBe(1);
    });
});

//----------------------------------------------------------------------------------------------------------------------

describe('NodeManager.children — link row owner attribution', () =>
{
    // A link row's wire target names who owns the TARGET, not the link's own owner (the recipient who placed it) --
    // the Owner column reads off this, not the link node's ownerID.
    it('carries the target\'s ownerID on a resolved link, distinct from the link\'s own owner', async () =>
    {
        await seedUser(handle.db, 'carol');
        await ra.insert(folderNode({ id: 'p', ownerID: 'alice' }));
        await ra.insert(folderNode({ id: 'far', ownerID: 'carol' }));
        await handle.db.insertInto('share').values({
            id: 'share_far_alice_2',
            node_id: 'far',
            grantee_user_id: 'alice',
            role: 'viewer',
            created_by: 'carol',
            created_at: new Date().toISOString(),
        })
            .execute();
        await ra.insert(linkNode({ id: 'lnk', ownerID: 'alice', parentID: 'p', targetNodeID: 'far' }));

        const manager = new NodeManager(handle, ra, noopOrphanedBlobs());
        const base = { limit: 50, offset: 0, sortKey: 'name', sortDirection: 'asc', types: [] } as const;

        const result = await manager.children(testActor({ id: 'alice' }), 'p', base);
        const link = result.nodes.find((node) => node.id === 'lnk');

        expect(link?.type).toBe('link');
        if(link?.type === 'link') { expect(link.target?.ownerID).toBe('carol'); }
        expect(link?.ownerID).toBe('alice');
    });

    // A dead link has no resolvable target -- here because alice was never granted access to it -- so it carries
    // none, and the client falls back to the link's own owner.
    it('carries no target on a dead link', async () =>
    {
        await seedUser(handle.db, 'dave');
        await ra.insert(folderNode({ id: 'p2', ownerID: 'alice' }));
        await ra.insert(folderNode({ id: 'unreachable', ownerID: 'dave' }));
        await ra.insert(linkNode({ id: 'deadlnk', ownerID: 'alice', parentID: 'p2', targetNodeID: 'unreachable' }));

        const manager = new NodeManager(handle, ra, noopOrphanedBlobs());
        const base = { limit: 50, offset: 0, sortKey: 'name', sortDirection: 'asc', types: [] } as const;

        const result = await manager.children(testActor({ id: 'alice' }), 'p2', base);
        const link = result.nodes.find((node) => node.id === 'deadlnk');

        expect(link?.type).toBe('link');
        if(link?.type === 'link') { expect(link.target).toBeNull(); }
    });
});

//----------------------------------------------------------------------------------------------------------------------

describe('NodeManager.children owner facet — link targets', () =>
{
    // A link displays the TARGET's owner, so the owner-filter menu must offer that owner too, even though carol has
    // placed nothing of her own inside this folder -- alice is the only direct owner in it.
    it('adds a resolved link\'s target owner to the facet', async () =>
    {
        await seedUser(handle.db, 'carol');
        await ra.insert(folderNode({ id: 'p', ownerID: 'alice' }));
        await ra.insert(folderNode({ id: 'far', ownerID: 'carol' }));
        await handle.db.insertInto('share').values({
            id: 'share_far_alice',
            node_id: 'far',
            grantee_user_id: 'alice',
            role: 'viewer',
            created_by: 'carol',
            created_at: new Date().toISOString(),
        })
            .execute();
        await ra.insert(linkNode({ id: 'lnk', ownerID: 'alice', parentID: 'p', targetNodeID: 'far' }));

        const manager = new NodeManager(handle, ra, noopOrphanedBlobs());
        const base = { limit: 50, offset: 0, sortKey: 'name', sortDirection: 'asc', types: [] } as const;

        const result = await manager.children(testActor({ id: 'alice' }), 'p', base);

        expect(new Set(result.owners.map((owner) => owner.id))).toEqual(new Set([ 'alice', 'carol' ]));
    });

    // A dead link (target unresolvable -- here, dave never granted alice access) contributes no target owner: dave
    // must not appear in the facet just because a dangling link points at him.
    it('does not add a spurious owner for a dead link\'s unresolvable target', async () =>
    {
        await seedUser(handle.db, 'dave');
        await ra.insert(folderNode({ id: 'p2', ownerID: 'alice' }));
        await ra.insert(folderNode({ id: 'unreachable', ownerID: 'dave' }));
        await ra.insert(linkNode({ id: 'deadlnk', ownerID: 'alice', parentID: 'p2', targetNodeID: 'unreachable' }));

        const manager = new NodeManager(handle, ra, noopOrphanedBlobs());
        const base = { limit: 50, offset: 0, sortKey: 'name', sortDirection: 'asc', types: [] } as const;

        const result = await manager.children(testActor({ id: 'alice' }), 'p2', base);

        expect(result.owners.map((owner) => owner.id)).toEqual([ 'alice' ]);
    });

    // bob already rides the facet as a direct owner in the folder; a link resolving to another of bob's nodes must
    // not duplicate him.
    it('does not duplicate an owner already present via direct ownership in the folder', async () =>
    {
        await seedUser(handle.db, 'bob');
        await ra.insert(folderNode({ id: 'p3', ownerID: 'alice' }));
        await ra.insert(fileNode({ id: 'bobFile', ownerID: 'bob', blobID: 'sha-a', parentID: 'p3' }));
        await ra.insert(folderNode({ id: 'bobTarget', ownerID: 'bob' }));
        await handle.db.insertInto('share').values({
            id: 'share_bobtarget_alice',
            node_id: 'bobTarget',
            grantee_user_id: 'alice',
            role: 'viewer',
            created_by: 'bob',
            created_at: new Date().toISOString(),
        })
            .execute();
        await ra.insert(linkNode({ id: 'lnk2', ownerID: 'alice', parentID: 'p3', targetNodeID: 'bobTarget' }));

        const manager = new NodeManager(handle, ra, noopOrphanedBlobs());
        const base = { limit: 50, offset: 0, sortKey: 'name', sortDirection: 'asc', types: [] } as const;

        const result = await manager.children(testActor({ id: 'alice' }), 'p3', base);

        expect(result.owners.map((owner) => owner.id).sort()).toEqual([ 'alice', 'bob' ]);
    });
});

//----------------------------------------------------------------------------------------------------------------------

describe('NodeManager.children through a folder link', () =>
{
    const base = { limit: 50, offset: 0, sortKey: 'name', sortDirection: 'asc', types: [] } as const;

    async function seedShare(
        nodeID : string,
        granteeID : string,
        role : 'viewer' | 'editor',
        createdBy : string
    ) : Promise<void>
    {
        await handle.db.insertInto('share').values({
            id: `share_${ nodeID }_${ granteeID }`,
            node_id: nodeID,
            grantee_user_id: granteeID,
            role,
            created_by: createdBy,
            created_at: new Date().toISOString(),
        })
            .execute();
    }

    // Passing a folder-link id as the parent lists the TARGET's children, and each child carries the role the caller
    // earns on the target itself -- inherited from the target's share, raised by a direct grant where one exists --
    // exactly the composition children(targetID) performs. The link lends nothing; it is a pure redirect.
    it('lists the target\'s children with the per-child role children(targetID) would compose', async () =>
    {
        await seedUser(handle.db, 'bob');
        await ra.insert(folderNode({ id: 'docs', ownerID: 'bob' }));
        await ra.insert(folderNode({ id: 'reports', ownerID: 'bob', parentID: 'docs' }));
        await ra.insert(folderNode({ id: 'secret', ownerID: 'bob', parentID: 'docs' }));
        await seedShare('docs', 'alice', 'viewer', 'bob');
        await seedShare('reports', 'alice', 'editor', 'bob');
        await ra.insert(linkNode({ id: 'lnk', ownerID: 'alice', targetNodeID: 'docs' }));

        const manager = new NodeManager(handle, ra, noopOrphanedBlobs());

        const throughLink = await manager.children(testActor({ id: 'alice' }), 'lnk', base);
        const direct = await manager.children(testActor({ id: 'alice' }), 'docs', base);

        // reports: max(viewer inherited, editor direct) = editor; secret: viewer inherited. And the whole page equals
        // what a direct read of the target would return.
        const roleByID = new Map(throughLink.nodes.map((node) => [ node.id, node.role ]));
        expect(roleByID.get('reports')).toBe('editor');
        expect(roleByID.get('secret')).toBe('viewer');
        expect(throughLink.nodes.map((node) => ({ id: node.id, role: node.role })))
            .toEqual(direct.nodes.map((node) => ({ id: node.id, role: node.role })));
    });

    // Listing THROUGH a folder link folds the target's owner into the listing's owner facet, even when that owner holds
    // nothing directly among the listed children -- the link crumb's hover card reads that owner summary off the facet
    // without a second fetch.
    it('adds the traversed link target\'s owner to the owner facet', async () =>
    {
        await seedUser(handle.db, 'bob');
        await ra.insert(folderNode({ id: 'empty', ownerID: 'bob' }));
        await seedShare('empty', 'alice', 'viewer', 'bob');
        await ra.insert(linkNode({ id: 'lnk', ownerID: 'alice', targetNodeID: 'empty' }));

        const manager = new NodeManager(handle, ra, noopOrphanedBlobs());

        const result = await manager.children(testActor({ id: 'alice' }), 'lnk', base);

        // The target folder is empty, so bob owns none of its children -- he rides the facet only as the traversed
        // link's target owner.
        expect(result.nodes).toEqual([]);
        expect(result.owners.map((owner) => owner.id)).toContain('bob');
    });

    // A link whose target the caller cannot resolve is a dead link: listing through it is a 404, the same read-as-
    // absent a direct read of the unreachable target would give, and the message never names the target.
    it('answers 404 when the link\'s target does not resolve for the caller', async () =>
    {
        await seedUser(handle.db, 'dave');
        await ra.insert(folderNode({ id: 'far', ownerID: 'dave' }));
        await ra.insert(folderNode({ id: 'inside', ownerID: 'dave', parentID: 'far' }));
        await ra.insert(linkNode({ id: 'deadlnk', ownerID: 'alice', targetNodeID: 'far' }));

        const manager = new NodeManager(handle, ra, noopOrphanedBlobs());

        await expect(manager.children(testActor({ id: 'alice' }), 'deadlnk', base)).rejects.toThrow(NotFoundError);
    });

    // A link to a trashed folder owned by someone else is absent to the recipient: the resolver ignores trash state,
    // so the trashed-target guard is what turns the listing into a 404, mirroring a direct read of a trashed shared
    // folder.
    it('answers 404 when the link\'s target is a trashed folder owned by another user', async () =>
    {
        await seedUser(handle.db, 'carol');
        await ra.insert(folderNode({ id: 'ct', ownerID: 'carol', trashedAt: new Date() }));
        await seedShare('ct', 'alice', 'viewer', 'carol');
        await ra.insert(linkNode({ id: 'trlnk', ownerID: 'alice', targetNodeID: 'ct' }));

        const manager = new NodeManager(handle, ra, noopOrphanedBlobs());

        await expect(manager.children(testActor({ id: 'alice' }), 'trlnk', base)).rejects.toThrow(NotFoundError);
    });

    // The breadcrumb reads the current-folder crumb off get(linkID): it must return the LINK node -- its own name and
    // placement, with the target resolved for display -- not the target node. Deep-linking /folder/<linkID> depends
    // on this being unchanged.
    it('reads the link node itself, carrying its own name, via get(linkID)', async () =>
    {
        await seedUser(handle.db, 'bob');
        await ra.insert(folderNode({ id: 'docs', ownerID: 'bob', name: 'Documents' }));
        await seedShare('docs', 'alice', 'viewer', 'bob');
        await ra.insert(linkNode({ id: 'lnk', ownerID: 'alice', targetNodeID: 'docs', name: 'Case Test\'s Docs' }));

        const manager = new NodeManager(handle, ra, noopOrphanedBlobs());

        const node = await manager.get(testActor({ id: 'alice' }), 'lnk');

        expect(node).toMatchObject({ id: 'lnk', type: 'link', name: 'Case Test\'s Docs', role: 'owner' });
        if(node.type === 'link')
        {
            expect(node.targetNodeID).toBe('docs');
            expect(node.target).toMatchObject({ id: 'docs', type: 'folder', name: 'Documents' });
        }
    });
});

//----------------------------------------------------------------------------------------------------------------------
