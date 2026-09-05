//----------------------------------------------------------------------------------------------------------------------
// ShareRA — permission resolver
//
// Drives the effective-role resolver against a real in-memory SQLite database (production factory + migrator, zero
// mocks), so the recursive ancestor walk and the grant joins run as they do in a deployment. Every expectation is
// derived from the rules -- effective role = max of ownership, direct grant, inherited grant; links never conduct
// permission; a folder owner keeps access to cross-owner contributions inside it -- never from what the query
// happens to return.
//----------------------------------------------------------------------------------------------------------------------

/* eslint-disable camelcase -- the cycle fixture writes a snake_case DB column directly (house convention) */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { Kysely } from 'kysely';

// Models
import type { Share, ShareRole } from '@fileshed/core';

// Resource Access
import type { Database, DatabaseHandle } from '@server/resource-access/database/database.ts';
import { NodeRA } from '@server/resource-access/nodes/node.ts';
import { ShareRA } from '@server/resource-access/shares/index.ts';

// Support
import {
    createTestDatabase,
    fileNode,
    folderNode,
    linkNode,
    seedBackend,
    seedBlob,
    seedUser,
} from '../nodes/support.ts';

//----------------------------------------------------------------------------------------------------------------------

let handle : DatabaseHandle;
let db : Kysely<Database>;
let nodes : NodeRA;
let shares : ShareRA;

beforeEach(async () =>
{
    handle = await createTestDatabase();
    db = handle.db;
    nodes = new NodeRA(handle);
    shares = new ShareRA(handle);

    await seedUser(db, 'owner');
    await seedUser(db, 'grantee');
    await seedUser(db, 'stranger');
    await seedUser(db, 'outsider');
    await seedBackend(db, 'be1');
    await seedBlob(db, 'sha-a', 'be1');
});

afterEach(async () =>
{
    await db.destroy();
});

let shareSeq = 0;

async function grant(nodeID : string, granteeUserID : string, role : ShareRole, createdBy = 'owner') : Promise<void>
{
    shareSeq += 1;
    const share : Share = {
        id: `share-${ shareSeq }`,
        nodeID,
        granteeUserID,
        role,
        createdBy,
        createdAt: new Date('2026-02-01T00:00:00.000Z'),
    };
    await shares.upsertShare(share);
}

//----------------------------------------------------------------------------------------------------------------------
// effectiveRole
//----------------------------------------------------------------------------------------------------------------------

describe('ShareRA.effectiveRole', () =>
{
    it('resolves the owner of a node to owner', async () =>
    {
        await nodes.insert(folderNode({ id: 'f', ownerID: 'owner' }));

        expect(await shares.effectiveRole('owner', 'f')).toBe('owner');
    });

    it('resolves a user with no ownership and no grant to no access', async () =>
    {
        await nodes.insert(folderNode({ id: 'f', ownerID: 'owner' }));

        expect(await shares.effectiveRole('stranger', 'f')).toBeNull();
    });

    it('grants the role of a direct share on the node itself', async () =>
    {
        await nodes.insert(folderNode({ id: 'f', ownerID: 'owner' }));
        await grant('f', 'grantee', 'viewer');

        expect(await shares.effectiveRole('grantee', 'f')).toBe('viewer');
    });

    it('inherits a share on an ancestor folder down the subtree', async () =>
    {
        await nodes.insert(folderNode({ id: 'top', ownerID: 'owner' }));
        await nodes.insert(folderNode({ id: 'mid', ownerID: 'owner', parentID: 'top' }));
        await nodes.insert(fileNode({ id: 'leaf', ownerID: 'owner', blobID: 'sha-a', parentID: 'mid' }));
        await grant('top', 'grantee', 'editor');

        expect(await shares.effectiveRole('grantee', 'leaf')).toBe('editor');
    });

    it('takes the max of a direct viewer grant and an inherited editor grant', async () =>
    {
        await nodes.insert(folderNode({ id: 'top', ownerID: 'owner' }));
        await nodes.insert(fileNode({ id: 'leaf', ownerID: 'owner', blobID: 'sha-a', parentID: 'top' }));
        await grant('top', 'grantee', 'editor');
        await grant('leaf', 'grantee', 'viewer');

        // max(inherited editor, direct viewer) = editor.
        expect(await shares.effectiveRole('grantee', 'leaf')).toBe('editor');
    });

    it('resolves to no access again once the share is revoked', async () =>
    {
        await nodes.insert(folderNode({ id: 'f', ownerID: 'owner' }));
        await grant('f', 'grantee', 'editor');
        const [ share ] = await shares.listByNode('f');
        if(share === undefined) { throw new Error('the grant was never created'); }
        await shares.deleteShare(share.id);

        expect(await shares.effectiveRole('grantee', 'f')).toBeNull();
    });

    it('gives the folder owner owner-role over a cross-owner contribution placed inside it', async () =>
    {
        // owner shares F with grantee as editor; grantee contributes X into F (X owned by grantee, parent F).
        await nodes.insert(folderNode({ id: 'F', ownerID: 'owner' }));
        await grant('F', 'grantee', 'editor');
        await nodes.insert(fileNode({ id: 'X', ownerID: 'grantee', blobID: 'sha-a', parentID: 'F' }));

        // grantee owns X directly; the folder owner reaches it by owning an ancestor (F); a stranger has nothing.
        expect(await shares.effectiveRole('grantee', 'X')).toBe('owner');
        expect(await shares.effectiveRole('owner', 'X')).toBe('owner');
        expect(await shares.effectiveRole('stranger', 'X')).toBeNull();
    });

    it('carries ancestor ownership down a deep chain to a contribution several levels in', async () =>
    {
        // owner's chain top -> mid -> deep; the grantee contributes X at the bottom, owning only X itself.
        await nodes.insert(folderNode({ id: 'top', ownerID: 'owner' }));
        await nodes.insert(folderNode({ id: 'mid', ownerID: 'owner', parentID: 'top' }));
        await nodes.insert(folderNode({ id: 'deep', ownerID: 'owner', parentID: 'mid' }));
        await grant('top', 'grantee', 'editor');
        await nodes.insert(fileNode({ id: 'X', ownerID: 'grantee', blobID: 'sha-a', parentID: 'deep' }));

        // The owner owns no node in X's chain except its ancestors -- three levels up is still ownership.
        expect(await shares.effectiveRole('owner', 'X')).toBe('owner');
        expect(await shares.effectiveRole('grantee', 'X')).toBe('owner');
        expect(await shares.effectiveRole('stranger', 'X')).toBeNull();
    });

    // Cycle prevention should make a loop in the parent edges impossible, so this stages one by writing the
    // edge directly. The resolver runs on every authenticated request, so a corrupt edge must bound the walk and still
    // answer -- without the depth ceiling this query never returns.
    it('terminates on a cycle in the parent edges instead of walking forever', async () =>
    {
        await nodes.insert(folderNode({ id: 'a', ownerID: 'owner' }));
        await nodes.insert(folderNode({ id: 'b', ownerID: 'owner', parentID: 'a' }));
        await db.updateTable('node').set({ parent_id: 'b' })
            .where('id', '=', 'a')
            .execute();

        expect(await shares.effectiveRole('owner', 'a')).toBe('owner');
        expect(await shares.effectiveRole('stranger', 'a')).toBeNull();
    });

    it('does not conduct a folder share through a link to a node outside the folder', async () =>
    {
        // outsider owns a file in their own tree; owner places a link to it inside a folder shared to grantee.
        await nodes.insert(fileNode({ id: 'outside', ownerID: 'outsider', blobID: 'sha-a', parentID: null }));
        await nodes.insert(folderNode({ id: 'shared', ownerID: 'owner' }));
        await nodes.insert(linkNode({ id: 'lk', ownerID: 'owner', parentID: 'shared', targetNodeID: 'outside' }));
        await grant('shared', 'grantee', 'editor');

        // The link itself sits in the shared subtree, so it inherits the grant -- grantee can see the stub.
        expect(await shares.effectiveRole('grantee', 'lk')).toBe('editor');
        // But the target resolves against its OWN ancestor chain (outsider's root), which the shared folder is not part
        // of, so the folder share grants NOTHING on the target (THE hazard).
        expect(await shares.effectiveRole('grantee', 'outside')).toBeNull();
    });
});

//----------------------------------------------------------------------------------------------------------------------
// effectiveRoles — batch (one query for a children page)
//----------------------------------------------------------------------------------------------------------------------

describe('ShareRA.effectiveRoles', () =>
{
    it('resolves a mix of nodes in one call, matching the single-node resolver per node', async () =>
    {
        await nodes.insert(folderNode({ id: 'top', ownerID: 'owner' }));
        await nodes.insert(fileNode({ id: 'own', ownerID: 'grantee', blobID: 'sha-a', parentID: 'top' }));
        await nodes.insert(fileNode({ id: 'shared', ownerID: 'owner', blobID: 'sha-a', parentID: 'top' }));
        await nodes.insert(fileNode({ id: 'hidden', ownerID: 'owner', blobID: 'sha-a', parentID: null }));
        await grant('top', 'grantee', 'viewer');

        const roles = await shares.effectiveRoles('grantee', [ 'own', 'shared', 'hidden' ]);

        // own: grantee owns it -> owner. shared: inherits viewer from top. hidden: no path -> null.
        expect(roles.get('own')).toBe('owner');
        expect(roles.get('shared')).toBe('viewer');
        expect(roles.get('hidden')).toBeNull();
    });

    it('resolves ancestor-owned contributions in one batch, at one and two levels up', async () =>
    {
        await nodes.insert(folderNode({ id: 'top', ownerID: 'owner' }));
        await nodes.insert(folderNode({ id: 'mid', ownerID: 'owner', parentID: 'top' }));
        await grant('top', 'grantee', 'editor');
        await nodes.insert(fileNode({ id: 'c1', ownerID: 'grantee', blobID: 'sha-a', parentID: 'top' }));
        await nodes.insert(fileNode({ id: 'c2', ownerID: 'grantee', blobID: 'sha-a', parentID: 'mid' }));
        await nodes.insert(fileNode({ id: 'own', ownerID: 'owner', blobID: 'sha-a', parentID: 'top' }));

        const batch = await shares.effectiveRoles('owner', [ 'c1', 'c2', 'own', 'top' ]);

        // The owner reaches both contributions by owning an ancestor -- one level up for c1, two for c2 --
        // and owns 'own' and 'top' outright.
        expect(batch.get('c1')).toBe('owner');
        expect(batch.get('c2')).toBe('owner');
        expect(batch.get('own')).toBe('owner');
        expect(batch.get('top')).toBe('owner');
    });

    it('seeds every requested node, so an unknown or access-less node maps to null rather than absent', async () =>
    {
        await nodes.insert(folderNode({ id: 'f', ownerID: 'owner' }));

        const roles = await shares.effectiveRoles('stranger', [ 'f', 'does-not-exist' ]);

        expect(roles.get('f')).toBeNull();
        expect(roles.get('does-not-exist')).toBeNull();
        expect(roles.has('does-not-exist')).toBe(true);
    });

    it('returns an empty map for an empty id list', async () =>
    {
        expect((await shares.effectiveRoles('grantee', [])).size).toBe(0);
    });
});

//----------------------------------------------------------------------------------------------------------------------
