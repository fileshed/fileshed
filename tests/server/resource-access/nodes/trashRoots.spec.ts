//----------------------------------------------------------------------------------------------------------------------
// NodeRA — trashed-root listing
//
// Drives trashedRoots/countTrashedRoots against a real in-memory SQLite database (production factory + migrator, zero
// mocks), so the correlated NOT EXISTS and the folders-first ordering are exercised as they run in a deployment. Every
// expectation is derived by hand from the required behavior: a trash view lists the ROOTS of a caller's own trashed
// subtrees -- a trashed folder once, its descendants riding along -- never another owner's, never a link.
//----------------------------------------------------------------------------------------------------------------------

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { Kysely } from 'kysely';

// Resource Access
import type { Database, DatabaseHandle } from '@server/resource-access/database/database.ts';
import { type NodeFilters, NodeRA } from '@server/resource-access/nodes/node.ts';

// Support
import { createTestDatabase, fileNode, folderNode, linkNode, seedBackend, seedBlob, seedUser } from './support.ts';

//----------------------------------------------------------------------------------------------------------------------

let handle : DatabaseHandle;
let db : Kysely<Database>;
let ra : NodeRA;

const trashedAt = new Date('2026-03-01T00:00:00.000Z');
const byName = { pagination: { limit: 100, offset: 0 }, sort: { key: 'name' as const, direction: 'asc' as const } };

beforeEach(async () =>
{
    handle = await createTestDatabase();
    db = handle.db;
    ra = new NodeRA(handle);

    await seedUser(db, 'u1');
    await seedUser(db, 'u2');
    await seedBackend(db, 'be1');
    await seedBlob(db, 'sha-a', 'be1');
});

afterEach(async () =>
{
    await db.destroy();
});

function file(
    id : string,
    extra : { parentID ?: string | null; ownerID ?: string; name ?: string } = {}
) : ReturnType<typeof fileNode>
{
    return fileNode({ id, ownerID: extra.ownerID ?? 'u1', blobID: 'sha-a', ...extra });
}

//----------------------------------------------------------------------------------------------------------------------

describe('NodeRA.trashedRoots', () =>
{
    it('lists a caller\'s trashed node and omits their live ones', async () =>
    {
        await ra.insert(folderNode({ id: 'live', ownerID: 'u1' }));
        await ra.insert(folderNode({ id: 'gone', ownerID: 'u1' }));
        await ra.setTrashed('gone', trashedAt);

        const roots = await ra.trashedRoots('u1', byName);

        expect(roots.map((node) => node.id)).toEqual([ 'gone' ]);
    });

    // setTrashed stamps the whole subtree, so a trashed folder's descendants each carry a trashed_at. Only the root
    // may list -- a child whose parent is also trashed would double-list the same removal.
    it('lists a trashed folder once and never its trashed descendants', async () =>
    {
        await ra.insert(folderNode({ id: 'folder', ownerID: 'u1' }));
        await ra.insert(folderNode({ id: 'sub', ownerID: 'u1', parentID: 'folder' }));
        await ra.insert(file('child', { parentID: 'folder' }));
        await ra.setTrashed('folder', trashedAt);

        const roots = await ra.trashedRoots('u1', byName);

        expect(roots.map((node) => node.id)).toEqual([ 'folder' ]);
        expect(await ra.countTrashedRoots('u1')).toBe(1);
    });

    // A file trashed on its own, its parent folder left live, IS the root of its (single-node) trashed subtree.
    it('lists a directly trashed file whose parent folder stays live', async () =>
    {
        await ra.insert(folderNode({ id: 'keep', ownerID: 'u1' }));
        await ra.insert(file('doc', { parentID: 'keep' }));
        await ra.setTrashed('doc', trashedAt);

        const roots = await ra.trashedRoots('u1', byName);

        expect(roots.map((node) => node.id)).toEqual([ 'doc' ]);
    });

    it('scopes to the caller: another owner\'s trashed node never appears', async () =>
    {
        await ra.insert(folderNode({ id: 'mine', ownerID: 'u1' }));
        await ra.insert(folderNode({ id: 'theirs', ownerID: 'u2' }));
        await ra.setTrashed('mine', trashedAt);
        await ra.setTrashed('theirs', trashedAt);

        const roots = await ra.trashedRoots('u1', byName);

        expect(roots.map((node) => node.id)).toEqual([ 'mine' ]);
    });

    // A link never carries trashed_at (setTrashed skips it), so trashing its parent folder hides the link
    // transitively while its own row stays live -- the trash view lists the folder root alone.
    it('lists a trashed folder holding a link, and not the link', async () =>
    {
        await ra.insert(folderNode({ id: 'holder', ownerID: 'u1' }));
        await ra.insert(folderNode({ id: 'target', ownerID: 'u1' }));
        await ra.insert(linkNode({ id: 'lk', ownerID: 'u1', parentID: 'holder', targetNodeID: 'target' }));
        await ra.setTrashed('holder', trashedAt);

        const roots = await ra.trashedRoots('u1', byName);

        expect(roots.map((node) => node.id)).toEqual([ 'holder' ]);
    });

    // The trash view mirrors the folder listing's ordering contract: folders pin above the file partition whatever
    // the name, then the sort key runs within each partition.
    it('pins folders above files, applying the sort key within each partition', async () =>
    {
        await ra.insert(folderNode({ id: 'zeta', ownerID: 'u1', name: 'zeta' }));
        await ra.insert(file('apple', { name: 'apple' }));
        await ra.insert(file('mango', { name: 'mango' }));
        await ra.setTrashed('zeta', trashedAt);
        await ra.setTrashed('apple', trashedAt);
        await ra.setTrashed('mango', trashedAt);

        const roots = await ra.trashedRoots('u1', byName);

        expect(roots.map((node) => node.id)).toEqual([ 'zeta', 'apple', 'mango' ]);
    });

    // The trash view folds case exactly as a folder listing does: apple, Banana, cherry, on either database.
    it('orders names case-insensitively', async () =>
    {
        await ra.insert(file('t-banana', { name: 'Banana' }));
        await ra.insert(file('t-cherry', { name: 'cherry' }));
        await ra.insert(file('t-apple', { name: 'apple' }));
        await ra.setTrashed('t-banana', trashedAt);
        await ra.setTrashed('t-cherry', trashedAt);
        await ra.setTrashed('t-apple', trashedAt);

        const roots = await ra.trashedRoots('u1', byName);

        expect(roots.map((node) => node.name)).toEqual([ 'apple', 'Banana', 'cherry' ]);
    });

    it('pages the roots deterministically', async () =>
    {
        await ra.insert(file('a', { name: 'a' }));
        await ra.insert(file('b', { name: 'b' }));
        await ra.insert(file('c', { name: 'c' }));
        await ra.setTrashed('a', trashedAt);
        await ra.setTrashed('b', trashedAt);
        await ra.setTrashed('c', trashedAt);

        const sort = { key: 'name' as const, direction: 'asc' as const };
        const page1 = await ra.trashedRoots('u1', { pagination: { limit: 2, offset: 0 }, sort });
        const page2 = await ra.trashedRoots('u1', { pagination: { limit: 2, offset: 2 }, sort });

        expect(page1.map((node) => node.id)).toEqual([ 'a', 'b' ]);
        expect(page2.map((node) => node.id)).toEqual([ 'c' ]);
        expect(await ra.countTrashedRoots('u1')).toBe(3);
    });
});

//----------------------------------------------------------------------------------------------------------------------

// The trash view honours the same Type/Modified filters a folder listing does, applied to the trashed ROOTS. Because
// the filter rides the root predicate, it narrows which roots list -- it never reaches into the descendants riding
// along under a trashed folder, so roots-only survives the filter.
describe('NodeRA.trashedRoots — Type and Modified filters', () =>
{
    it('narrows trashed roots to the selected type families', async () =>
    {
        await ra.insert(fileNode({ id: 'pic', ownerID: 'u1', blobID: 'sha-a', mimeType: 'image/png' }));
        await ra.insert(fileNode({ id: 'doc', ownerID: 'u1', blobID: 'sha-a', mimeType: 'application/pdf' }));
        await ra.insert(folderNode({ id: 'dir', ownerID: 'u1' }));
        await ra.setTrashed('pic', trashedAt);
        await ra.setTrashed('doc', trashedAt);
        await ra.setTrashed('dir', trashedAt);

        const images : NodeFilters = { types: [ 'images' ] };

        const roots = await ra.trashedRoots('u1', byName, images);

        expect(roots.map((node) => node.id)).toEqual([ 'pic' ]);
        expect(await ra.countTrashedRoots('u1', images)).toBe(1);
    });

    // A trashed folder is the root; an image living INSIDE it is a descendant that never lists on its own. So filtering
    // the trash by 'images' surfaces nothing when the only trashed root is a folder -- the filter tests the root's own
    // type, not its contents.
    it('filters on the root\'s own type, never the descendants riding along under a trashed folder', async () =>
    {
        await ra.insert(folderNode({ id: 'album', ownerID: 'u1' }));
        await ra.insert(fileNode({ id: 'inside',
            ownerID: 'u1',
            parentID: 'album',
            blobID: 'sha-a',
            mimeType: 'image/png' }));
        await ra.setTrashed('album', trashedAt);

        expect((await ra.trashedRoots('u1', byName, { types: [ 'images' ] })).map((node) => node.id)).toEqual([]);
        expect((await ra.trashedRoots('u1', byName, { types: [ 'folders' ] })).map((node) => node.id))
            .toEqual([ 'album' ]);
    });

    it('narrows trashed roots to the half-open modified window (after inclusive, before exclusive)', async () =>
    {
        await ra.insert(fileNode({ id: 'old',
            ownerID: 'u1',
            blobID: 'sha-a',
            updatedAt: new Date('2026-01-10T00:00:00.000Z') }));
        await ra.insert(fileNode({ id: 'mid',
            ownerID: 'u1',
            blobID: 'sha-a',
            updatedAt: new Date('2026-02-10T00:00:00.000Z') }));
        await ra.insert(fileNode({ id: 'new',
            ownerID: 'u1',
            blobID: 'sha-a',
            updatedAt: new Date('2026-03-10T00:00:00.000Z') }));
        await ra.setTrashed('old', trashedAt);
        await ra.setTrashed('mid', trashedAt);
        await ra.setTrashed('new', trashedAt);

        const window : NodeFilters = {
            types: [],
            updatedAfter: new Date('2026-02-01T00:00:00.000Z'),
            updatedBefore: new Date('2026-03-01T00:00:00.000Z'),
        };

        expect((await ra.trashedRoots('u1', byName, window)).map((node) => node.id)).toEqual([ 'mid' ]);
        expect(await ra.countTrashedRoots('u1', window)).toBe(1);
    });

    it('still scopes to the caller under a filter: another owner\'s matching trashed root never appears', async () =>
    {
        await ra.insert(fileNode({ id: 'mine', ownerID: 'u1', blobID: 'sha-a', mimeType: 'image/png' }));
        await ra.insert(fileNode({ id: 'theirs', ownerID: 'u2', blobID: 'sha-a', mimeType: 'image/png' }));
        await ra.setTrashed('mine', trashedAt);
        await ra.setTrashed('theirs', trashedAt);

        const roots = await ra.trashedRoots('u1', byName, { types: [ 'images' ] });

        expect(roots.map((node) => node.id)).toEqual([ 'mine' ]);
    });
});

//----------------------------------------------------------------------------------------------------------------------

describe('NodeRA.countTrashedRoots', () =>
{
    it('counts roots, not the descendants that ride along', async () =>
    {
        await ra.insert(folderNode({ id: 'f1', ownerID: 'u1' }));
        await ra.insert(folderNode({ id: 'f1-sub', ownerID: 'u1', parentID: 'f1' }));
        await ra.insert(folderNode({ id: 'f2', ownerID: 'u1' }));
        await ra.setTrashed('f1', trashedAt);
        await ra.setTrashed('f2', trashedAt);

        expect(await ra.countTrashedRoots('u1')).toBe(2);
    });

    it('is zero for an owner with nothing trashed', async () =>
    {
        await ra.insert(folderNode({ id: 'live', ownerID: 'u1' }));

        expect(await ra.countTrashedRoots('u1')).toBe(0);
    });
});

//----------------------------------------------------------------------------------------------------------------------

describe('NodeRA.trashedRootIDs', () =>
{
    it('lists the bare ids of a caller\'s trashed roots, unpaginated', async () =>
    {
        await ra.insert(folderNode({ id: 'live', ownerID: 'u1' }));
        await ra.insert(folderNode({ id: 'gone', ownerID: 'u1' }));
        await ra.setTrashed('gone', trashedAt);

        expect(await ra.trashedRootIDs('u1')).toEqual([ 'gone' ]);
    });

    // setTrashed stamps the whole subtree, so a trashed folder's descendants each carry a trashed_at too -- only the
    // root's id may appear, the same root definition trashedRoots pages by.
    it('lists a trashed folder\'s id once, never its trashed descendants', async () =>
    {
        await ra.insert(folderNode({ id: 'folder', ownerID: 'u1' }));
        await ra.insert(folderNode({ id: 'sub', ownerID: 'u1', parentID: 'folder' }));
        await ra.insert(file('child', { parentID: 'folder' }));
        await ra.setTrashed('folder', trashedAt);

        expect(await ra.trashedRootIDs('u1')).toEqual([ 'folder' ]);
    });

    it('scopes to the caller: another owner\'s trashed node never appears', async () =>
    {
        await ra.insert(folderNode({ id: 'mine', ownerID: 'u1' }));
        await ra.insert(folderNode({ id: 'theirs', ownerID: 'u2' }));
        await ra.setTrashed('mine', trashedAt);
        await ra.setTrashed('theirs', trashedAt);

        expect(await ra.trashedRootIDs('u1')).toEqual([ 'mine' ]);
    });

    it('is empty for an owner with nothing trashed', async () =>
    {
        await ra.insert(folderNode({ id: 'live', ownerID: 'u1' }));

        expect(await ra.trashedRootIDs('u1')).toEqual([]);
    });
});

//----------------------------------------------------------------------------------------------------------------------
