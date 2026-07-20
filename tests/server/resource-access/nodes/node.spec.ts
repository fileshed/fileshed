//----------------------------------------------------------------------------------------------------------------------
// NodeRA — query surface
//
// Drives NodeRA against a real in-memory SQLite database (production factory + migrator, zero mocks), so the recursive
// CTEs, the FK cascades, and the derived aggregates are exercised as they run in a deployment. Every expectation is
// derived from requirements.md (secs 3.2/3.2b/4.2/4.4/5/7), not from what the queries happen to return.
//----------------------------------------------------------------------------------------------------------------------

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { Kysely } from 'kysely';

// Resource Access
import type { Database, DatabaseHandle } from '@server/resource-access/database/database.ts';
import { NodeRA } from '@server/resource-access/nodes/node.ts';

// Support
import { createTestDatabase, fileNode, folderNode, linkNode, seedBackend, seedBlob, seedUser } from './support.ts';

//----------------------------------------------------------------------------------------------------------------------

let handle : DatabaseHandle;
let db : Kysely<Database>;
let ra : NodeRA;

beforeEach(async () =>
{
    handle = await createTestDatabase();
    db = handle.db;
    ra = new NodeRA(handle);

    await seedUser(db, 'u1');
    await seedUser(db, 'u2');
    await seedBackend(db, 'be1');
    await seedBlob(db, 'sha-a', 'be1');
    await seedBlob(db, 'sha-b', 'be1');
});

afterEach(async () =>
{
    await db.destroy();
});

// A file owned by u1 referencing sha-a, with only the fields a test cares about spelled out.
function file(id : string, extra : { parentID ?: string | null; size ?: number; ownerID ?: string; updatedAt ?: Date })
: ReturnType<typeof fileNode>
{
    return fileNode({ id, ownerID: extra.ownerID ?? 'u1', blobID: 'sha-a', ...extra });
}

async function idsInTable() : Promise<string[]>
{
    const rows = await db.selectFrom('node').select('id')
        .execute();
    return rows.map((row) => row.id);
}

// Whether each of the given ids currently has trashed_at set, in the order asked.
async function trashedFlags(ids : string[]) : Promise<boolean[]>
{
    const rows = await db
        .selectFrom('node')
        .select([ 'id', 'trashed_at' ])
        .where('id', 'in', ids)
        .execute();

    const flags = new Map(rows.map((row) => [ row.id, row.trashed_at !== null ]));
    return ids.map((id) => flags.get(id) ?? false);
}

const byName = { pagination: { limit: 100, offset: 0 }, sort: { key: 'name' as const, direction: 'asc' as const } };

//----------------------------------------------------------------------------------------------------------------------
// children (requirements.md secs 3.2/4.4/7)
//----------------------------------------------------------------------------------------------------------------------

describe('NodeRA.children', () =>
{
    it('lists the owner\'s own nodes under a folder, links included', async () =>
    {
        await ra.insert(folderNode({ id: 'p', ownerID: 'u1' }));
        await ra.insert(folderNode({ id: 'target', ownerID: 'u1' }));
        await ra.insert(file('cf', { parentID: 'p' }));
        await ra.insert(folderNode({ id: 'sf', ownerID: 'u1', parentID: 'p' }));
        await ra.insert(linkNode({ id: 'lk', ownerID: 'u1', parentID: 'p', targetNodeID: 'target' }));

        const children = await ra.children({ parentID: 'p', ownerID: 'u1' }, byName);

        expect(children.map((node) => node.id)).toEqual([ 'cf', 'lk', 'sf' ]);
        expect(children.find((node) => node.id === 'lk')?.type).toBe('link');
    });

    it('lists root-level nodes when parentID is null', async () =>
    {
        await ra.insert(folderNode({ id: 'root-a', ownerID: 'u1', parentID: null }));
        await ra.insert(folderNode({ id: 'nested', ownerID: 'u1', parentID: 'root-a' }));

        const children = await ra.children({ parentID: null, ownerID: 'u1' }, byName);

        expect(children.map((node) => node.id)).toEqual([ 'root-a' ]);
    });

    it('excludes nodes owned by another user under the same parent (sec 3.3 cross-owner contributions)', async () =>
    {
        await ra.insert(folderNode({ id: 'p', ownerID: 'u1' }));
        await ra.insert(file('mine', { parentID: 'p' }));
        await ra.insert(file('theirs', { parentID: 'p', ownerID: 'u2' }));

        const children = await ra.children({ parentID: 'p', ownerID: 'u1' }, byName);

        expect(children.map((node) => node.id)).toEqual([ 'mine' ]);
    });

    it('excludes trashed nodes from the normal listing (sec 4.4)', async () =>
    {
        await ra.insert(folderNode({ id: 'p', ownerID: 'u1' }));
        await ra.insert(file('live', { parentID: 'p' }));
        await ra.insert(file('gone', { parentID: 'p' }));
        await ra.setTrashed('gone', new Date('2026-03-01T00:00:00.000Z'));

        const children = await ra.children({ parentID: 'p', ownerID: 'u1' }, byName);

        expect(children.map((node) => node.id)).toEqual([ 'live' ]);
    });

    it('paginates with limit and offset over a name-sorted listing', async () =>
    {
        await ra.insert(folderNode({ id: 'p', ownerID: 'u1' }));
        await Promise.all([ 'a', 'b', 'c', 'd', 'e' ].map((name) => ra.insert(file(name, { parentID: 'p' }))));

        const sort = { key: 'name' as const, direction: 'asc' as const };
        const at = { parentID: 'p', ownerID: 'u1' };
        const page1 = await ra.children(at, { pagination: { limit: 2, offset: 0 }, sort });
        const page2 = await ra.children(at, { pagination: { limit: 2, offset: 2 }, sort });
        const page3 = await ra.children(at, { pagination: { limit: 2, offset: 4 }, sort });

        expect(page1.map((node) => node.id)).toEqual([ 'a', 'b' ]);
        expect(page2.map((node) => node.id)).toEqual([ 'c', 'd' ]);
        expect(page3.map((node) => node.id)).toEqual([ 'e' ]);
    });

    it('sorts by name in both directions', async () =>
    {
        await ra.insert(folderNode({ id: 'p', ownerID: 'u1' }));
        await ra.insert(file('banana', { parentID: 'p' }));
        await ra.insert(file('apple', { parentID: 'p' }));
        await ra.insert(file('cherry', { parentID: 'p' }));

        const asc = await ra.children(
            { parentID: 'p', ownerID: 'u1' },
            { pagination: { limit: 100, offset: 0 }, sort: { key: 'name', direction: 'asc' } }
        );
        const desc = await ra.children(
            { parentID: 'p', ownerID: 'u1' },
            { pagination: { limit: 100, offset: 0 }, sort: { key: 'name', direction: 'desc' } }
        );

        expect(asc.map((node) => node.id)).toEqual([ 'apple', 'banana', 'cherry' ]);
        expect(desc.map((node) => node.id)).toEqual([ 'cherry', 'banana', 'apple' ]);
    });

    it('sorts by size', async () =>
    {
        await ra.insert(folderNode({ id: 'p', ownerID: 'u1' }));
        await ra.insert(file('big', { parentID: 'p', size: 30 }));
        await ra.insert(file('small', { parentID: 'p', size: 10 }));
        await ra.insert(file('mid', { parentID: 'p', size: 20 }));

        const children = await ra.children(
            { parentID: 'p', ownerID: 'u1' },
            { pagination: { limit: 100, offset: 0 }, sort: { key: 'size', direction: 'asc' } }
        );

        expect(children.map((node) => node.id)).toEqual([ 'small', 'mid', 'big' ]);
    });

    it('sorts by updatedAt', async () =>
    {
        await ra.insert(folderNode({ id: 'p', ownerID: 'u1' }));
        await ra.insert(file('newest', { parentID: 'p', updatedAt: new Date('2026-05-03T00:00:00.000Z') }));
        await ra.insert(file('oldest', { parentID: 'p', updatedAt: new Date('2026-05-01T00:00:00.000Z') }));
        await ra.insert(file('middle', { parentID: 'p', updatedAt: new Date('2026-05-02T00:00:00.000Z') }));

        const children = await ra.children(
            { parentID: 'p', ownerID: 'u1' },
            { pagination: { limit: 100, offset: 0 }, sort: { key: 'updatedAt', direction: 'asc' } }
        );

        expect(children.map((node) => node.id)).toEqual([ 'oldest', 'middle', 'newest' ]);
    });
});

//----------------------------------------------------------------------------------------------------------------------
// ancestorIDs (requirements.md secs 3.2/3.2b)
//----------------------------------------------------------------------------------------------------------------------

describe('NodeRA.ancestorIDs', () =>
{
    // r -> a -> b -> c, four deep.
    async function buildChain() : Promise<void>
    {
        await ra.insert(folderNode({ id: 'r', ownerID: 'u1', parentID: null }));
        await ra.insert(folderNode({ id: 'a', ownerID: 'u1', parentID: 'r' }));
        await ra.insert(folderNode({ id: 'b', ownerID: 'u1', parentID: 'a' }));
        await ra.insert(folderNode({ id: 'c', ownerID: 'u1', parentID: 'b' }));
    }

    it('returns the parent chain nearest-first, excluding the node itself', async () =>
    {
        await buildChain();

        expect(await ra.ancestorIDs('c')).toEqual([ 'b', 'a', 'r' ]);
    });

    it('returns an empty chain for a root node', async () =>
    {
        await buildChain();

        expect(await ra.ancestorIDs('r')).toEqual([]);
    });

    it('walks parent edges only — a link never joins the chain, and its target never redirects it', async () =>
    {
        await buildChain();
        await ra.insert(linkNode({ id: 'lk', ownerID: 'u1', parentID: 'c', targetNodeID: 'r' }));

        // The link climbs its own placement (c..r); it does NOT jump through its target.
        expect(await ra.ancestorIDs('lk')).toEqual([ 'c', 'b', 'a', 'r' ]);
        // And c's chain is untouched by the link that now sits under it.
        expect(await ra.ancestorIDs('c')).toEqual([ 'b', 'a', 'r' ]);
    });
});

//----------------------------------------------------------------------------------------------------------------------
// trash / restore / hardDelete (requirements.md secs 3.2b/4.4)
//----------------------------------------------------------------------------------------------------------------------

describe('NodeRA.setTrashed', () =>
{
    // f -> { cf (file), sf (folder) -> sff (file) }, plus a link lk under f.
    async function buildTree() : Promise<void>
    {
        await ra.insert(folderNode({ id: 'f', ownerID: 'u1' }));
        await ra.insert(file('cf', { parentID: 'f' }));
        await ra.insert(folderNode({ id: 'sf', ownerID: 'u1', parentID: 'f' }));
        await ra.insert(file('sff', { parentID: 'sf' }));
        await ra.insert(linkNode({ id: 'lk', ownerID: 'u1', parentID: 'f', targetNodeID: 'cf' }));
    }

    it('trashes the whole subtree as a unit, leaving inner links untouched (links are never trashed)', async () =>
    {
        await buildTree();

        await ra.setTrashed('f', new Date('2026-04-01T00:00:00.000Z'));

        expect(await trashedFlags([ 'f', 'cf', 'sf', 'sff' ])).toEqual([ true, true, true, true ]);
        // The link inside the trashed folder keeps trashed_at NULL (the variant CHECK forbids it, sec 3.2b); it hides
        // transitively via its trashed ancestor.
        expect(await trashedFlags([ 'lk' ])).toEqual([ false ]);
    });

    it('restore clears trashed_at across the subtree', async () =>
    {
        await buildTree();
        await ra.setTrashed('f', new Date('2026-04-01T00:00:00.000Z'));

        await ra.setTrashed('f', null);

        expect(await trashedFlags([ 'f', 'cf', 'sf', 'sff' ])).toEqual([ false, false, false, false ]);
    });
});

describe('NodeRA.hardDelete', () =>
{
    it('cascades to the subtree and to links targeting a deleted node', async () =>
    {
        await ra.insert(folderNode({ id: 'f', ownerID: 'u1' }));
        await ra.insert(file('cf', { parentID: 'f' }));
        await ra.insert(folderNode({ id: 'sf', ownerID: 'u1', parentID: 'f' }));
        // A link outside f (u2's root) targeting a file inside f, so only the target cascade can remove it.
        await ra.insert(linkNode({ id: 'lk', ownerID: 'u2', parentID: null, targetNodeID: 'cf' }));

        await ra.hardDelete('f');

        expect(await idsInTable()).toEqual([]);
    });
});

//----------------------------------------------------------------------------------------------------------------------
// ownedBytes (requirements.md sec 5)
//----------------------------------------------------------------------------------------------------------------------

describe('NodeRA.ownedBytes', () =>
{
    it('sums owned file sizes including trashed, excluding folders, links, and other owners', async () =>
    {
        await ra.insert(file('live', { size: 100 }));
        await ra.insert(file('trashed', { size: 50 }));
        await ra.setTrashed('trashed', new Date('2026-04-01T00:00:00.000Z'));
        await ra.insert(folderNode({ id: 'folder', ownerID: 'u1' }));
        await ra.insert(linkNode({ id: 'lk', ownerID: 'u1', targetNodeID: 'live' }));
        await ra.insert(file('theirs', { size: 999, ownerID: 'u2' }));

        // 100 (live) + 50 (trashed still counts); folder and link have no size, u2's file is not u1's charge.
        expect(await ra.ownedBytes('u1')).toBe(150);
    });

    it('returns 0 for an owner with no file nodes', async () =>
    {
        await ra.insert(folderNode({ id: 'folder', ownerID: 'u1' }));

        expect(await ra.ownedBytes('u1')).toBe(0);
    });
});

//----------------------------------------------------------------------------------------------------------------------
// get / getMany
//----------------------------------------------------------------------------------------------------------------------

describe('NodeRA.get and getMany', () =>
{
    it('get returns the reconstructed domain node', async () =>
    {
        const node = folderNode({ id: 'd1', ownerID: 'u1' });
        await ra.insert(node);

        expect(await ra.get('d1')).toEqual(node);
    });

    it('get returns undefined for a missing id', async () =>
    {
        expect(await ra.get('nope')).toBeUndefined();
    });

    it('getMany resolves several nodes and returns [] for an empty id list', async () =>
    {
        await ra.insert(folderNode({ id: 'd1', ownerID: 'u1' }));
        await ra.insert(folderNode({ id: 'd2', ownerID: 'u1' }));

        const many = await ra.getMany([ 'd1', 'd2' ]);

        expect(many.map((node) => node.id).sort()).toEqual([ 'd1', 'd2' ]);
        expect(await ra.getMany([])).toEqual([]);
    });
});

//----------------------------------------------------------------------------------------------------------------------
