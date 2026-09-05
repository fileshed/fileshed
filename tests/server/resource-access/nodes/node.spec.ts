//----------------------------------------------------------------------------------------------------------------------
// NodeRA — query surface
//
// Drives NodeRA against a real in-memory SQLite database (production factory + migrator, zero mocks), so the recursive
// CTEs, the FK cascades, and the derived aggregates are exercised as they run in a deployment. Every expectation is
// derived by hand from the required behavior, not from what the queries happen to return.
//----------------------------------------------------------------------------------------------------------------------

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { Kysely } from 'kysely';

// Resource Access
import type { Database, DatabaseHandle } from '@server/resource-access/database/database.ts';
import { type AccessScope, type NodeFilters, NodeRA } from '@server/resource-access/nodes/node.ts';

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
function file(
    id : string,
    extra : {
        parentID ?: string | null;
        size ?: number;
        ownerID ?: string;
        updatedAt ?: Date;
        name ?: string;
        mimeType ?: string;
    }
) : ReturnType<typeof fileNode>
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
// children
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

        // Folder 'sf' leads whatever its name (folders sort above the file/link partition); 'cf' and 'lk' follow in
        // name order, the link grouped with the file below the folders.
        expect(children.map((node) => node.id)).toEqual([ 'sf', 'cf', 'lk' ]);
        expect(children.find((node) => node.id === 'lk')?.type).toBe('link');
    });

    // Folders always sort above non-folders in a listing, regardless of the sort key or its direction; files and links
    // share the lower partition, which the sort key then orders. This is a server-side invariant because it must hold
    // across paginated pages a client cannot re-partition.
    it('pins folders above files and links, applying the sort key within each partition', async () =>
    {
        await ra.insert(folderNode({ id: 'p', ownerID: 'u1' }));
        await ra.insert(folderNode({ id: 'tgt', ownerID: 'u1' }));
        // Names chosen so folders would NOT lead on name alone -- 'yolk'/'zeta' sort after 'apple'/'berry'/'mango'.
        await ra.insert(folderNode({ id: 'zeta', ownerID: 'u1', parentID: 'p' }));
        await ra.insert(folderNode({ id: 'yolk', ownerID: 'u1', parentID: 'p' }));
        await ra.insert(file('apple', { parentID: 'p' }));
        await ra.insert(file('mango', { parentID: 'p' }));
        await ra.insert(linkNode({ id: 'berry', ownerID: 'u1', parentID: 'p', targetNodeID: 'tgt' }));

        const children = await ra.children({ parentID: 'p', ownerID: 'u1' }, byName);

        expect(children.map((node) => node.id)).toEqual([ 'yolk', 'zeta', 'apple', 'berry', 'mango' ]);
    });

    it('keeps folders on top under descending order, flipping only the sort within each partition', async () =>
    {
        await ra.insert(folderNode({ id: 'p', ownerID: 'u1' }));
        await ra.insert(folderNode({ id: 'dir-a', ownerID: 'u1', parentID: 'p', name: 'apple' }));
        await ra.insert(folderNode({ id: 'dir-b', ownerID: 'u1', parentID: 'p', name: 'banana' }));
        await ra.insert(file('file-x', { parentID: 'p', name: 'x-ray' }));
        await ra.insert(file('file-y', { parentID: 'p', name: 'yellow' }));

        const desc = await ra.children(
            { parentID: 'p', ownerID: 'u1' },
            { pagination: { limit: 100, offset: 0 }, sort: { key: 'name', direction: 'desc' } }
        );

        // The folders-first criterion is direction-independent: folders still lead. Only the within-partition name
        // runs descending -- banana before apple, yellow before x-ray.
        expect(desc.map((node) => node.id)).toEqual([ 'dir-b', 'dir-a', 'file-y', 'file-x' ]);
    });

    it('keeps folders on the first page across a page boundary, whatever their name', async () =>
    {
        await ra.insert(folderNode({ id: 'p', ownerID: 'u1' }));
        // Three files whose names all sort before the folder's, enough to fill the first page on their own.
        await ra.insert(file('a', { parentID: 'p' }));
        await ra.insert(file('b', { parentID: 'p' }));
        await ra.insert(file('c', { parentID: 'p' }));
        // A folder whose name sorts dead last -- naive name order would exile it to page 2.
        await ra.insert(folderNode({ id: 'zzz', ownerID: 'u1', parentID: 'p' }));

        const sort = { key: 'name' as const, direction: 'asc' as const };
        const at = { parentID: 'p', ownerID: 'u1' };
        const page1 = await ra.children(at, { pagination: { limit: 2, offset: 0 }, sort });
        const page2 = await ra.children(at, { pagination: { limit: 2, offset: 2 }, sort });

        expect(page1.map((node) => node.id)).toEqual([ 'zzz', 'a' ]);
        expect(page2.map((node) => node.id)).toEqual([ 'b', 'c' ]);
    });

    it('sorts the lower partition by type then mime under the kind key, folders still on top', async () =>
    {
        await ra.insert(folderNode({ id: 'p', ownerID: 'u1' }));
        await ra.insert(folderNode({ id: 'dir', ownerID: 'u1', parentID: 'p' }));
        await ra.insert(file('aaa', { parentID: 'p', mimeType: 'text/plain' }));
        await ra.insert(file('bbb', { parentID: 'p', mimeType: 'application/pdf' }));
        await ra.insert(linkNode({ id: 'ccc', ownerID: 'u1', parentID: 'p', targetNodeID: 'dir' }));

        const children = await ra.children(
            { parentID: 'p', ownerID: 'u1' },
            { pagination: { limit: 100, offset: 0 }, sort: { key: 'kind', direction: 'asc' } }
        );

        // 'dir' (folder) leads. Files order by mime -- application/pdf before text/plain -- so bbb precedes aaa though
        // its name sorts later. The link trails the files: type 'file' sorts before 'link' within the lower partition.
        expect(children.map((node) => node.id)).toEqual([ 'dir', 'bbb', 'aaa', 'ccc' ]);
    });

    it('lists root-level nodes when parentID is null', async () =>
    {
        await ra.insert(folderNode({ id: 'root-a', ownerID: 'u1', parentID: null }));
        await ra.insert(folderNode({ id: 'nested', ownerID: 'u1', parentID: 'root-a' }));

        const children = await ra.children({ parentID: null, ownerID: 'u1' }, byName);

        expect(children.map((node) => node.id)).toEqual([ 'root-a' ]);
    });

    // A contribution belongs to its creator but travels with the folder -- a folder's listing includes every
    // child regardless of owner. Only the root listing (parentID null) is per-owner, where the per-user trees begin.
    it('includes cross-owner contributions under a folder, while the root listing stays per-owner', async () =>
    {
        await ra.insert(folderNode({ id: 'p', ownerID: 'u1' }));
        await ra.insert(file('mine', { parentID: 'p' }));
        await ra.insert(file('theirs', { parentID: 'p', ownerID: 'u2' }));
        await ra.insert(folderNode({ id: 'other-root', ownerID: 'u2', parentID: null }));

        const children = await ra.children({ parentID: 'p', ownerID: 'u1' }, byName);
        const roots = await ra.children({ parentID: null, ownerID: 'u1' }, byName);

        expect(children.map((node) => node.id)).toEqual([ 'mine', 'theirs' ]);
        expect(roots.map((node) => node.id)).toEqual([ 'p' ]);
    });

    it('excludes trashed nodes from the normal listing', async () =>
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

    // Names order the way a reader reads them, with capitalization ignored: apple, Banana, cherry. Comparing raw text
    // would answer Banana, apple, cherry wherever bytes decide the comparison, and a deployment's listing must not
    // depend on which database is underneath it.
    it('orders names case-insensitively, so capitalization never reshuffles the listing', async () =>
    {
        await ra.insert(folderNode({ id: 'p', ownerID: 'u1' }));
        await ra.insert(file('f-banana', { parentID: 'p', name: 'Banana' }));
        await ra.insert(file('f-cherry', { parentID: 'p', name: 'cherry' }));
        await ra.insert(file('f-apple', { parentID: 'p', name: 'apple' }));

        const asc = await ra.children({ parentID: 'p', ownerID: 'u1' }, byName);
        const desc = await ra.children(
            { parentID: 'p', ownerID: 'u1' },
            { pagination: { limit: 100, offset: 0 }, sort: { key: 'name', direction: 'desc' } }
        );

        expect(asc.map((node) => node.name)).toEqual([ 'apple', 'Banana', 'cherry' ]);
        expect(desc.map((node) => node.name)).toEqual([ 'cherry', 'Banana', 'apple' ]);
    });

    // Folding case decides the order WITHIN each partition; it never lets a file climb above a folder.
    it('keeps folders pinned above the file partition while folding case within each', async () =>
    {
        await ra.insert(folderNode({ id: 'p', ownerID: 'u1' }));
        await ra.insert(folderNode({ id: 'd-zebra', ownerID: 'u1', parentID: 'p', name: 'Zebra' }));
        await ra.insert(folderNode({ id: 'd-apricot', ownerID: 'u1', parentID: 'p', name: 'apricot' }));
        await ra.insert(file('f-quince', { parentID: 'p', name: 'Quince' }));
        await ra.insert(file('f-almond', { parentID: 'p', name: 'almond' }));

        const children = await ra.children({ parentID: 'p', ownerID: 'u1' }, byName);

        expect(children.map((node) => node.name)).toEqual([ 'apricot', 'Zebra', 'almond', 'Quince' ]);
    });

    // Two names differing only in case fold to the same sort value, leaving the id tiebreak to decide -- the same
    // tiebreak that keeps a paginated listing from repeating or dropping a row when the sort key ties.
    it('breaks a case-only name tie by id, so a tie stays deterministic', async () =>
    {
        await ra.insert(folderNode({ id: 'p', ownerID: 'u1' }));
        await ra.insert(file('id-b', { parentID: 'p', name: 'report.txt' }));
        await ra.insert(file('id-a', { parentID: 'p', name: 'REPORT.txt' }));

        const children = await ra.children({ parentID: 'p', ownerID: 'u1' }, byName);

        expect(children.map((node) => node.id)).toEqual([ 'id-a', 'id-b' ]);
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

    // A link carries no size at all, and the two dialects disagree about where an absent value belongs unless the
    // listing says so: Postgres sorts nulls high, SQLite sorts them low. A deployment's sort order must not depend
    // on which database it runs, so the sizeless rows sit at the end of an ascending page on both.
    it('sorts sizeless nodes to the end of an ascending size page, whatever the dialect', async () =>
    {
        await ra.insert(folderNode({ id: 'p', ownerID: 'u1' }));
        await ra.insert(file('big', { parentID: 'p', size: 30 }));
        await ra.insert(file('small', { parentID: 'p', size: 10 }));
        await ra.insert(linkNode({ id: 'sizeless', ownerID: 'u1', parentID: 'p', targetNodeID: 'big' }));

        const children = await ra.children(
            { parentID: 'p', ownerID: 'u1' },
            { pagination: { limit: 100, offset: 0 }, sort: { key: 'size', direction: 'asc' } }
        );

        expect(children.map((node) => node.id)).toEqual([ 'small', 'big', 'sizeless' ]);
    });

    it('sorts sizeless nodes to the front of a descending size page, whatever the dialect', async () =>
    {
        await ra.insert(folderNode({ id: 'p', ownerID: 'u1' }));
        await ra.insert(file('big', { parentID: 'p', size: 30 }));
        await ra.insert(file('small', { parentID: 'p', size: 10 }));
        await ra.insert(linkNode({ id: 'sizeless', ownerID: 'u1', parentID: 'p', targetNodeID: 'big' }));

        const children = await ra.children(
            { parentID: 'p', ownerID: 'u1' },
            { pagination: { limit: 100, offset: 0 }, sort: { key: 'size', direction: 'desc' } }
        );

        expect(children.map((node) => node.id)).toEqual([ 'sizeless', 'big', 'small' ]);
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
// children — type / owner / modified filters
//----------------------------------------------------------------------------------------------------------------------

describe('NodeRA.children filters', () =>
{
    // A folder 'p' with one node per type family (plus an unclassified binary), so a family filter's WHERE can be
    // proven by exactly which ids survive.
    async function seedFamilies() : Promise<void>
    {
        await ra.insert(folderNode({ id: 'p', ownerID: 'u1' }));
        await ra.insert(folderNode({ id: 'target', ownerID: 'u1' }));
        await ra.insert(folderNode({ id: 'dir', ownerID: 'u1', parentID: 'p' }));
        await ra.insert(linkNode({ id: 'lk', ownerID: 'u1', parentID: 'p', targetNodeID: 'target' }));
        await ra.insert(file('doc', { parentID: 'p', mimeType: 'text/markdown' }));
        await ra.insert(file('txt', { parentID: 'p', mimeType: 'text/plain' }));
        await ra.insert(file('pdf', { parentID: 'p', mimeType: 'application/pdf' }));
        await ra.insert(file('img', { parentID: 'p', mimeType: 'image/png' }));
        await ra.insert(file('vid', { parentID: 'p', mimeType: 'video/mp4' }));
        await ra.insert(file('aud', { parentID: 'p', mimeType: 'audio/mpeg' }));
        await ra.insert(file('zip', { parentID: 'p', mimeType: 'application/zip' }));
        await ra.insert(file('rar', { parentID: 'p', mimeType: 'application/x-rar-compressed' }));
        await ra.insert(file('bin', { parentID: 'p', mimeType: 'application/octet-stream' }));

        // Two playlists, one per witness: a proper m3u mime, and an extension-only file whose uploader supplied a
        // useless generic mime -- the common shape of an m3u dragged in from disk. Uppercase extension on purpose.
        await ra.insert(file('plmime', { parentID: 'p', mimeType: 'audio/x-mpegurl', name: 'mix.m3u8' }));
        await ra.insert(file('plext', { parentID: 'p', mimeType: 'application/octet-stream', name: 'Road.M3U' }));
    }

    const at = { parentID: 'p', ownerID: 'u1' };

    async function filtered(types : NodeFilters['types']) : Promise<string[]>
    {
        const rows = await ra.children(at, byName, { types });
        return rows.map((node) => node.id);
    }

    it('selects folders and links by node type', async () =>
    {
        await seedFamilies();

        expect(await filtered([ 'folders' ])).toEqual([ 'dir' ]);
        expect(await filtered([ 'links' ])).toEqual([ 'lk' ]);
    });

    it('selects documents as every text/* file and pdfs as application/pdf exactly', async () =>
    {
        await seedFamilies();

        expect(await filtered([ 'documents' ])).toEqual([ 'doc', 'txt' ]);
        expect(await filtered([ 'pdfs' ])).toEqual([ 'pdf' ]);
    });

    it('selects the media families by mime prefix', async () =>
    {
        await seedFamilies();

        expect(await filtered([ 'images' ])).toEqual([ 'img' ]);
        expect(await filtered([ 'video' ])).toEqual([ 'vid' ]);
        expect(await filtered([ 'audio' ])).toEqual([ 'aud' ]);
    });

    // Media types are case-insensitive by definition, and nothing normalizes what an API client sends -- a browser
    // lowercases File.type for us, a curl caller does not. The family filter classifies on the type, not its casing.
    it('classifies a file whose mime arrived uppercased', async () =>
    {
        await seedFamilies();
        await ra.insert(file('shouty', { parentID: 'p', mimeType: 'IMAGE/PNG' }));

        expect(await filtered([ 'images' ])).toEqual([ 'img', 'shouty' ]);
    });

    // The audio assertion above is itself the carve-out's proof: plmime carries an audio/-prefixed mime and would
    // pollute the Audio filter without the exclusion.
    it('selects playlists by mime or by extension alone, whatever the stored mime says', async () =>
    {
        await seedFamilies();

        expect((await filtered([ 'playlists' ])).sort()).toEqual([ 'plext', 'plmime' ]);
    });

    it('selects archives as the fixed archive-mime set, excluding an unclassified binary', async () =>
    {
        await seedFamilies();

        expect(await filtered([ 'archives' ])).toEqual([ 'rar', 'zip' ]);
        // The octet-stream binary belongs to no family, so no single-family filter ever returns it.
        expect(await filtered([ 'archives', 'documents', 'images' ])).not.toContain('bin');
    });

    it('ORs multiple selected families together', async () =>
    {
        await seedFamilies();

        expect(await filtered([ 'images', 'pdfs' ])).toEqual([ 'img', 'pdf' ]);
        // Folders still lead the mixed result: the folders-first partition is independent of the filter.
        expect(await filtered([ 'folders', 'images' ])).toEqual([ 'dir', 'img' ]);
    });

    it('filters a folder listing to one owner', async () =>
    {
        await ra.insert(folderNode({ id: 'p', ownerID: 'u1' }));
        await ra.insert(file('mine', { parentID: 'p', ownerID: 'u1' }));
        await ra.insert(file('theirs', { parentID: 'p', ownerID: 'u2' }));

        const rows = await ra.children(at, byName, { types: [], ownerID: 'u2' });

        expect(rows.map((node) => node.id)).toEqual([ 'theirs' ]);
    });

    // The modified window is half-open: updatedAfter includes a node stamped exactly at the bound, updatedBefore
    // excludes one stamped exactly at it.
    it('applies a half-open modified window — after inclusive, before exclusive', async () =>
    {
        await ra.insert(folderNode({ id: 'p', ownerID: 'u1' }));
        await ra.insert(file('a', { parentID: 'p', updatedAt: new Date('2026-03-01T00:00:00.000Z') }));
        await ra.insert(file('b', { parentID: 'p', updatedAt: new Date('2026-06-01T00:00:00.000Z') }));
        await ra.insert(file('c', { parentID: 'p', updatedAt: new Date('2026-09-01T00:00:00.000Z') }));

        const bound = new Date('2026-06-01T00:00:00.000Z');
        const after = await ra.children(at, byName, { types: [], updatedAfter: bound });
        const before = await ra.children(at, byName, { types: [], updatedBefore: bound });
        const window = await ra.children(at, byName, {
            types: [],
            updatedAfter: bound,
            updatedBefore: new Date('2026-09-01T00:00:00.000Z'),
        });

        expect(after.map((node) => node.id)).toEqual([ 'b', 'c' ]);
        expect(before.map((node) => node.id)).toEqual([ 'a' ]);
        expect(window.map((node) => node.id)).toEqual([ 'b' ]);
    });

    it('keeps folders-first ordering and pagination under a filter', async () =>
    {
        await seedFamilies();
        const sort = { key: 'name' as const, direction: 'asc' as const };

        const page1 = await ra.children(at, { pagination: { limit: 1, offset: 0 }, sort }, {
            types: [ 'folders', 'documents' ],
        });
        const page2 = await ra.children(
            at,
            { pagination: { limit: 1, offset: 1 }, sort },
            { types: [ 'folders', 'documents' ] }
        );

        // dir (folder) leads its filtered partition; doc/txt follow in name order across the page boundary.
        expect(page1.map((node) => node.id)).toEqual([ 'dir' ]);
        expect(page2.map((node) => node.id)).toEqual([ 'doc' ]);
    });

    it('counts the filtered listing, not the whole folder', async () =>
    {
        await seedFamilies();

        const count = await ra.countChildren(at, { types: [ 'images' ] });
        const page = await ra.children(at, byName, { types: [ 'images' ] });

        expect(count).toBe(1);
        expect(count).toBe(page.length);
    });

    // The name filter is an EXACT equality (collision detection), not the substring searchByName runs: a child named
    // exactly "report.pdf" matches, one merely containing it does not.
    it('matches a child by exact name, not by substring', async () =>
    {
        await ra.insert(folderNode({ id: 'p', ownerID: 'u1' }));
        await ra.insert(file('exact', { parentID: 'p', name: 'report.pdf' }));
        await ra.insert(file('longer', { parentID: 'p', name: 'report.pdf.bak' }));
        await ra.insert(file('other', { parentID: 'p', name: 'notes.txt' }));

        const rows = await ra.children(at, byName, { types: [], name: 'report.pdf' });

        expect(rows.map((node) => node.id)).toEqual([ 'exact' ]);
    });

    // The name filter AND-composes with the other facets, and countChildren applies the same filters as the page, so
    // a name filtered to one owner counts only that owner's matching child.
    it('composes the name filter with an owner filter, and countChildren agrees with the page', async () =>
    {
        await ra.insert(folderNode({ id: 'p', ownerID: 'u1' }));
        await ra.insert(file('mine', { parentID: 'p', ownerID: 'u1', name: 'shared.txt' }));
        await ra.insert(file('theirs', { parentID: 'p', ownerID: 'u2', name: 'shared.txt' }));

        const filters = { types: [], name: 'shared.txt', ownerID: 'u2' };
        const page = await ra.children(at, byName, filters);
        const count = await ra.countChildren(at, filters);

        expect(page.map((node) => node.id)).toEqual([ 'theirs' ]);
        expect(count).toBe(1);
    });

    // A name filter under pagination surfaces the same match regardless of the page window -- the point of an exact
    // filter is answering "does a child named X exist?" without paging the whole folder.
    it('returns the exact-name match on the first page under pagination', async () =>
    {
        await ra.insert(folderNode({ id: 'p', ownerID: 'u1' }));
        await Promise.all(Array.from(
            { length: 5 },
            (_unused, index) => ra.insert(file(`filler-${ index }`, { parentID: 'p', name: `filler-${ index }.txt` }))
        ));
        await ra.insert(file('needle', { parentID: 'p', name: 'target.bin' }));

        const firstPage = await ra.children(
            at,
            { pagination: { limit: 1, offset: 0 }, sort: { key: 'name' as const, direction: 'asc' as const } },
            { types: [], name: 'target.bin' }
        );

        expect(firstPage.map((node) => node.id)).toEqual([ 'needle' ]);
    });

    it('treats an empty type selection with no owner or window as unfiltered', async () =>
    {
        await seedFamilies();

        const all = await ra.children(at, byName, { types: [] });
        const unfiltered = await ra.children(at, byName);

        expect(all.map((node) => node.id)).toEqual(unfiltered.map((node) => node.id));
    });
});

//----------------------------------------------------------------------------------------------------------------------
// searchByName
//----------------------------------------------------------------------------------------------------------------------

describe('NodeRA.searchByName', () =>
{
    // Everything u1 can reach and nothing else, stated as the scope the manager hands down.
    function scopeFor(userID : string, grantedNodeIDs : string[] = []) : AccessScope
    {
        return { userID, grantedNodeIDs };
    }

    // A result set orders by the same folded name a folder listing does, rather than gathering the capitalized hits
    // into a run of their own ahead of everything else.
    it('orders matches case-insensitively', async () =>
    {
        await ra.insert(file('f-banana', { name: 'Banana pie.txt' }));
        await ra.insert(file('f-cherry', { name: 'cherry pie.txt' }));
        await ra.insert(file('f-apple', { name: 'apple pie.txt' }));

        const matches = await ra.searchByName('pie', scopeFor('u1'), 100);

        expect(matches.map((node) => node.name)).toEqual([ 'apple pie.txt', 'Banana pie.txt', 'cherry pie.txt' ]);
    });

    // The scope is the caller's reach by the same rule permission resolution applies: their own nodes, whatever is
    // granted to them, and everything below either -- including a contribution inside their folder that someone else
    // owns, which an owner-only filter would miss.
    it('returns matches inside the caller\'s reach and nothing outside it', async () =>
    {
        await ra.insert(folderNode({ id: 'mine', ownerID: 'u1', name: 'pie-folder' }));
        await ra.insert(file('contributed', { parentID: 'mine', ownerID: 'u2', name: 'their pie.txt' }));
        await ra.insert(folderNode({ id: 'granted', ownerID: 'u2', name: 'granted pie' }));
        await ra.insert(file('under-granted', { parentID: 'granted', ownerID: 'u2', name: 'inner pie.txt' }));
        await ra.insert(folderNode({ id: 'stranger', ownerID: 'u2', name: 'stranger pie' }));
        await ra.insert(file('under-stranger', { parentID: 'stranger', ownerID: 'u2', name: 'hidden pie.txt' }));

        const matches = await ra.searchByName('pie', scopeFor('u1', [ 'granted' ]), 100);

        expect(matches.map((node) => node.id).sort())
            .toEqual([ 'contributed', 'granted', 'mine', 'under-granted' ]);
    });

    // What the whole scoping exists for: the cap cuts the CALLER's matches. Matches outside their reach never enter
    // the window, however many there are and however early they sort.
    it('spends the cap on the caller\'s own matches, never on someone else\'s', async () =>
    {
        await Promise.all(Array.from(
            { length: 4 },
            (_unused, index) => ra.insert(folderNode({
                id: `theirs-${ index }`, ownerID: 'u2', name: `aaa pie ${ index }`,
            }))
        ));
        await ra.insert(folderNode({ id: 'ours-1', ownerID: 'u1', name: 'zzz pie 1' }));
        await ra.insert(folderNode({ id: 'ours-2', ownerID: 'u1', name: 'zzz pie 2' }));

        const matches = await ra.searchByName('pie', scopeFor('u1'), 2);

        expect(matches.map((node) => node.id)).toEqual([ 'ours-1', 'ours-2' ]);
    });

    // A grant reaches down, never up: the folders above the granted one belong to its owner alone.
    it('reaches below a granted folder without exposing the folders above it', async () =>
    {
        await ra.insert(folderNode({ id: 'private', ownerID: 'u2', name: 'private pie' }));
        await ra.insert(folderNode({ id: 'shared', ownerID: 'u2', parentID: 'private', name: 'shared pie' }));
        await ra.insert(file('inside', { parentID: 'shared', ownerID: 'u2', name: 'deep pie.txt' }));

        const matches = await ra.searchByName('pie', scopeFor('u1', [ 'shared' ]), 100);

        expect(matches.map((node) => node.id).sort()).toEqual([ 'inside', 'shared' ]);
    });
});

//----------------------------------------------------------------------------------------------------------------------
// ownersOf — the owner facet
//----------------------------------------------------------------------------------------------------------------------

describe('NodeRA.ownersOf', () =>
{
    it('returns the folder\'s distinct owners as display summaries, ordered by name', async () =>
    {
        const adaSha = 'aa'.repeat(32);
        await seedUser(db, 'ada', { name: 'Ada', avatarSha256: adaSha });
        await ra.insert(folderNode({ id: 'p', ownerID: 'u1' }));
        await ra.insert(file('mine', { parentID: 'p', ownerID: 'u1' }));
        await ra.insert(file('mine2', { parentID: 'p', ownerID: 'u1' }));
        await ra.insert(file('theirs', { parentID: 'p', ownerID: 'ada' }));

        const owners = await ra.ownersOf({ parentID: 'p', ownerID: 'u1' });

        // u1 collapses to one row despite two files; ordered by name, 'Ada' precedes 'u1'. The summary carries the
        // joined display fields; image is derived from the avatar hash -- an /api/avatars URL when one is set, null
        // when the account has none.
        expect(owners.map((entry) => entry.id)).toEqual([ 'ada', 'u1' ]);
        expect(owners.find((entry) => entry.id === 'u1')).toEqual({
            id: 'u1', name: 'u1', email: 'u1@t.test', image: null,
        });
        expect(owners.find((entry) => entry.id === 'ada')?.image).toBe(`/api/avatars/${ adaSha }`);
    });

    it('excludes owners whose only nodes here are trashed', async () =>
    {
        await ra.insert(folderNode({ id: 'p', ownerID: 'u1' }));
        await ra.insert(file('mine', { parentID: 'p', ownerID: 'u1' }));
        await ra.insert(file('gone', { parentID: 'p', ownerID: 'u2' }));
        await ra.setTrashed('gone', new Date('2026-04-01T00:00:00.000Z'));

        const owners = await ra.ownersOf({ parentID: 'p', ownerID: 'u1' });

        expect(owners.map((entry) => entry.id)).toEqual([ 'u1' ]);
    });
});

//----------------------------------------------------------------------------------------------------------------------
// ancestorIDs
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
// subtreeHeight
//----------------------------------------------------------------------------------------------------------------------

describe('NodeRA.subtreeHeight', () =>
{
    it('answers 0 for a node with nothing under it', async () =>
    {
        await ra.insert(folderNode({ id: 'empty', ownerID: 'u1' }));
        await ra.insert(file('lone', {}));

        expect(await ra.subtreeHeight('empty')).toBe(0);
        expect(await ra.subtreeHeight('lone')).toBe(0);
    });

    // The height is the DEEPEST rung, not the number of descendants: a wide folder is still one rung tall.
    it('measures the deepest rung below the node, whatever the subtree\'s width', async () =>
    {
        await ra.insert(folderNode({ id: 'root', ownerID: 'u1' }));
        await ra.insert(file('wide-1', { parentID: 'root' }));
        await ra.insert(file('wide-2', { parentID: 'root' }));
        await ra.insert(folderNode({ id: 'mid', ownerID: 'u1', parentID: 'root' }));
        await ra.insert(folderNode({ id: 'lower', ownerID: 'u1', parentID: 'mid' }));
        await ra.insert(file('deep', { parentID: 'lower' }));

        expect(await ra.subtreeHeight('root')).toBe(3);
        expect(await ra.subtreeHeight('mid')).toBe(2);
    });

    // A link is an inert pointer: it counts as the leaf it is where it sits, and never redirects the descent into
    // whatever it targets.
    it('counts a link where it sits and never follows it to its target', async () =>
    {
        await ra.insert(folderNode({ id: 'tall', ownerID: 'u1' }));
        await ra.insert(folderNode({ id: 'tall-mid', ownerID: 'u1', parentID: 'tall' }));
        await ra.insert(file('tall-leaf', { parentID: 'tall-mid' }));
        await ra.insert(folderNode({ id: 'shelf', ownerID: 'u1' }));
        await ra.insert(linkNode({ id: 'lk', ownerID: 'u1', parentID: 'shelf', targetNodeID: 'tall' }));

        expect(await ra.subtreeHeight('shelf')).toBe(1);
    });
});

//----------------------------------------------------------------------------------------------------------------------
// ancestorChains
//----------------------------------------------------------------------------------------------------------------------

describe('NodeRA.ancestorChains', () =>
{
    // Two branches off a shared spine: r -> a -> b -> leafB, and r -> a -> x -> leafX.
    async function buildForest() : Promise<void>
    {
        await ra.insert(folderNode({ id: 'r', ownerID: 'u1', parentID: null, name: 'Root' }));
        await ra.insert(folderNode({ id: 'a', ownerID: 'u1', parentID: 'r', name: 'A' }));
        await ra.insert(folderNode({ id: 'b', ownerID: 'u1', parentID: 'a', name: 'B' }));
        await ra.insert(folderNode({ id: 'x', ownerID: 'u2', parentID: 'a', name: 'X' }));
        await ra.insert(file('leafB', { parentID: 'b' }));
        await ra.insert(file('leafX', { parentID: 'x' }));
    }

    function idsOf(chains : Map<string, { id : string }[]>, root : string) : string[]
    {
        return (chains.get(root) ?? []).map((ancestor) => ancestor.id);
    }

    // The whole point of the batch: many nodes, one walk, and each node's chain comes back attached to that node
    // rather than pooled -- otherwise a page of results could not tell whose ancestors are whose.
    it('keys each requested node\'s own chain separately, nearest parent first', async () =>
    {
        await buildForest();

        const chains = await ra.ancestorChains([ 'leafB', 'leafX' ]);

        expect(idsOf(chains, 'leafB')).toEqual([ 'b', 'a', 'r' ]);
        expect(idsOf(chains, 'leafX')).toEqual([ 'x', 'a', 'r' ]);
    });

    // A crumb has to render a label and be judged for where it roots, so each rung carries its name, its owner, and
    // its own parent edge.
    it('carries each ancestor\'s name, owner, and parent edge', async () =>
    {
        await buildForest();

        const chains = await ra.ancestorChains([ 'leafX' ]);

        expect(chains.get('leafX')).toEqual([
            { id: 'x', name: 'X', ownerID: 'u2', parentID: 'a' },
            { id: 'a', name: 'A', ownerID: 'u1', parentID: 'r' },
            { id: 'r', name: 'Root', ownerID: 'u1', parentID: null },
        ]);
    });

    it('omits a root node entirely, since it has no ancestors', async () =>
    {
        await buildForest();

        const chains = await ra.ancestorChains([ 'r', 'leafB' ]);

        expect(chains.has('r')).toBe(false);
        expect(idsOf(chains, 'leafB')).toEqual([ 'b', 'a', 'r' ]);
    });

    it('answers an empty request without touching the database', async () =>
    {
        await buildForest();

        expect(await ra.ancestorChains([])).toEqual(new Map());
    });

    it('walks parent edges only, so a link climbs its own placement rather than its target\'s', async () =>
    {
        await buildForest();
        await ra.insert(linkNode({ id: 'lk', ownerID: 'u1', parentID: 'b', targetNodeID: 'leafX' }));

        const chains = await ra.ancestorChains([ 'lk' ]);

        expect(idsOf(chains, 'lk')).toEqual([ 'b', 'a', 'r' ]);
    });
});

//----------------------------------------------------------------------------------------------------------------------
// trash / restore / hardDelete
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
        // The link inside the trashed folder keeps trashed_at NULL (the variant CHECK forbids it); it hides
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
// ownedBytes
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

describe('NodeRA.ownedBytesByOwner', () =>
{
    it('groups the same charge per owner, with no row for an owner with nothing', async () =>
    {
        await ra.insert(file('a1', { size: 100, ownerID: 'u1' }));
        await ra.insert(file('a2', { size: 50, ownerID: 'u1' }));
        await ra.setTrashed('a2', new Date('2026-04-01T00:00:00.000Z'));
        await ra.insert(folderNode({ id: 'folder', ownerID: 'u2' }));

        const usage = await ra.ownedBytesByOwner([ 'u1', 'u2' ]);

        // u1 charges 150 (trashed still counts); u2 owns only a sizeless folder, so no row at all.
        expect(usage.get('u1')).toBe(150);
        expect(usage.has('u2')).toBe(false);
    });

    it('answers an empty map for an empty owner list without touching the database', async () =>
    {
        expect((await ra.ownedBytesByOwner([])).size).toBe(0);
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
