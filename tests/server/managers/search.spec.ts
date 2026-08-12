//----------------------------------------------------------------------------------------------------------------------
// NodeManager.search — name search scoped to accessible nodes
//
// Drives the manager directly against a real NodeRA + real ShareRA over in-memory SQLite (zero mocks below the RA
// seam). v1 search is a case-insensitive name match scoped to the nodes the caller can resolve: a stranger's files
// never surface, shared-in nodes appear with the caller's effective role stamped, trashed nodes are excluded, and the
// page envelope counts only what the caller may actually reach.
//----------------------------------------------------------------------------------------------------------------------

/* eslint-disable camelcase -- the share seed names snake_case DB columns (house convention for Kysely inserts) */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

// Models
import type { NodeResponse, SearchResponse } from '@fileshed/core';

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
import { noopOrphanedBlobs, testNodePolicy, testSession } from '../nodes/support.ts';

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

function manager() : NodeManager
{
    return new NodeManager(handle, ra, noopOrphanedBlobs(), testNodePolicy());
}

function search(actorID : string, term : string, limit = 50, offset = 0) : Promise<SearchResponse>
{
    return manager().search(testSession({ id: actorID }), { q: term, limit, offset });
}

function crumbNamesOf(result : SearchResponse, nodeID : string) : string[]
{
    return (result.locations[nodeID]?.crumbs ?? []).map((crumb) => crumb.name);
}

function idsOf(nodes : NodeResponse[]) : string[]
{
    return nodes.map((node) => node.id).sort();
}

//----------------------------------------------------------------------------------------------------------------------

describe('NodeManager.search', () =>
{
    // Substring match, case-insensitive on both query and stored name, non-matches excluded. The caller's own matches
    // carry the owner role.
    it('matches names by case-insensitive substring and stamps the owner role on the caller\'s own nodes', async () =>
    {
        await ra.insert(fileNode({ id: 'r1', ownerID: 'alice', blobID: 'sha-a', name: 'Report.pdf' }));
        await ra.insert(folderNode({ id: 'r2', ownerID: 'alice', name: 'quarterly-report' }));
        await ra.insert(folderNode({ id: 'n1', ownerID: 'alice', name: 'Notes' }));

        const lower = await search('alice', 'report');
        const upper = await search('alice', 'REPORT');

        expect(idsOf(lower.nodes)).toEqual([ 'r1', 'r2' ]);
        expect(idsOf(upper.nodes)).toEqual([ 'r1', 'r2' ]);
        expect(lower.total).toBe(2);
        expect(lower.nodes.every((node) => node.role === 'owner')).toBe(true);
    });

    // Search reaches through to the content's embedded tags: a file whose NAME says nothing still surfaces when its
    // extracted artist/title/album matches -- the point of extracting tags at all -- while access scoping and the
    // trash exclusion behave exactly as they do for name matches.
    it('matches a file by its extracted artist, title, or album when the name says nothing', async () =>
    {
        await ra.insert(fileNode({ id: 't1', ownerID: 'alice', blobID: 'sha-a', name: '01-track.mp3' }));
        await handle.db
            .insertInto('media_tags')
            .values({ blob_id: 'sha-a', title: 'Neon Skyline', artist: 'The Sample Band', album: 'Fixtures' })
            .execute();

        expect(idsOf((await search('alice', 'sample band')).nodes)).toEqual([ 't1' ]);
        expect(idsOf((await search('alice', 'neon')).nodes)).toEqual([ 't1' ]);
        expect(idsOf((await search('alice', 'fixtures')).nodes)).toEqual([ 't1' ]);
        expect((await search('alice', 'zeppelin')).nodes).toHaveLength(0);

        // Tag matches obey the same access scoping as names: no reach, no result.
        expect((await search('carol', 'sample band')).nodes).toHaveLength(0);
    });

    // Scope is the caller: two users own a file with the same name; each sees only their own, a stranger with no access
    // sees neither.
    it('excludes nodes the caller cannot resolve, so a stranger\'s files never surface', async () =>
    {
        await ra.insert(fileNode({ id: 'aliceSecret', ownerID: 'alice', blobID: 'sha-a', name: 'secret-report' }));
        await ra.insert(fileNode({ id: 'bobSecret', ownerID: 'bob', blobID: 'sha-a', name: 'secret-report' }));

        const forAlice = await search('alice', 'secret');
        const forCarol = await search('carol', 'secret');

        expect(idsOf(forAlice.nodes)).toEqual([ 'aliceSecret' ]);
        expect(forAlice.total).toBe(1);
        expect(forCarol.nodes).toHaveLength(0);
        expect(forCarol.total).toBe(0);
    });

    // A share reaches the shared node and everything beneath it; both surface for the grantee with the granted role.
    it('includes shared-in nodes, direct and inherited, with the granted role stamped', async () =>
    {
        await ra.insert(folderNode({ id: 'sf', ownerID: 'alice', name: 'Reports' }));
        await ra.insert(fileNode({
            id: 'budget', ownerID: 'alice', parentID: 'sf', blobID: 'sha-a', name: 'budget-report',
        }));
        await seedShare('sf', 'bob', 'editor');

        const result = await search('bob', 'report');

        expect(idsOf(result.nodes)).toEqual([ 'budget', 'sf' ]);
        expect(result.total).toBe(2);
        expect(result.nodes.every((node) => node.role === 'editor')).toBe(true);
    });

    it('excludes trashed nodes from the results', async () =>
    {
        await ra.insert(fileNode({ id: 'live', ownerID: 'alice', blobID: 'sha-a', name: 'live-report' }));
        await ra.insert(fileNode({
            id: 'gone', ownerID: 'alice', blobID: 'sha-a', name: 'trashed-report', trashedAt: new Date(),
        }));

        const result = await search('alice', 'report');

        expect(idsOf(result.nodes)).toEqual([ 'live' ]);
        expect(result.total).toBe(1);
    });

    // total reflects the accessible match count; limit/offset slice that set, so a client can page every hit.
    it('paginates the accessible matches, reporting the full accessible total on every page', async () =>
    {
        await ra.insert(folderNode({ id: 'p1', ownerID: 'alice', name: 'report-1' }));
        await ra.insert(folderNode({ id: 'p2', ownerID: 'alice', name: 'report-2' }));
        await ra.insert(folderNode({ id: 'p3', ownerID: 'alice', name: 'report-3' }));

        const first = await search('alice', 'report', 2, 0);
        const second = await search('alice', 'report', 2, 2);

        expect(first.nodes.map((node) => node.name)).toEqual([ 'report-1', 'report-2' ]);
        expect(first.total).toBe(3);
        expect(second.nodes.map((node) => node.name)).toEqual([ 'report-3' ]);
        expect(second.total).toBe(3);
    });

    // LIKE metacharacters in the term match literally rather than as wildcards.
    it('treats a percent in the query as a literal, not a wildcard', async () =>
    {
        await ra.insert(folderNode({ id: 'lit', ownerID: 'alice', name: '50% off' }));
        await ra.insert(folderNode({ id: 'other', ownerID: 'alice', name: '50 dollars' }));

        const result = await search('alice', '50%');

        expect(idsOf(result.nodes)).toEqual([ 'lit' ]);
    });
});

//----------------------------------------------------------------------------------------------------------------------
// Owner facet -- every returned hit's owner is disclosed, since the caller can already see the node itself
//----------------------------------------------------------------------------------------------------------------------

describe('NodeManager.search owner facet', () =>
{
    it('carries the caller\'s own summary alongside a foreign owner\'s, deduped, for the returned page', async () =>
    {
        await ra.insert(fileNode({ id: 'mine', ownerID: 'alice', blobID: 'sha-a', name: 'facet-vulture-mine' }));
        await ra.insert(folderNode({ id: 'shared', ownerID: 'bob', name: 'facet-vulture-shared' }));
        await seedShare('shared', 'alice', 'viewer');

        const result = await search('alice', 'facet-vulture');

        expect(idsOf(result.nodes)).toEqual([ 'mine', 'shared' ]);
        expect(result.owners.map((owner) => owner.id).sort()).toEqual([ 'alice', 'bob' ]);
    });

    it('derives each owner\'s avatar image from their stored hash, null when they have none', async () =>
    {
        const bobSha = 'bb'.repeat(32);
        await handle.db
            .updateTable('user')
            .set({ avatar_sha256: bobSha })
            .where('id', '=', 'bob')
            .execute();
        await ra.insert(fileNode({ id: 'mine2', ownerID: 'alice', blobID: 'sha-a', name: 'facet-falcon-mine' }));
        await ra.insert(folderNode({ id: 'shared2', ownerID: 'bob', name: 'facet-falcon-shared' }));
        await seedShare('shared2', 'alice', 'viewer');

        const result = await search('alice', 'facet-falcon');

        expect(result.owners.find((owner) => owner.id === 'alice')).toEqual({
            id: 'alice', name: 'alice', email: 'alice@t.test', image: null,
        });
        expect(result.owners.find((owner) => owner.id === 'bob')?.image).toBe(`/api/avatars/${ bobSha }`);
    });

    // The facet faces the RETURNED PAGE, not the whole accessible match set -- unlike the folder listing's facet,
    // which faces the whole folder regardless of the current page.
    it('reflects only the current page\'s owners, not every accessible match behind it', async () =>
    {
        await ra.insert(folderNode({ id: 'p1', ownerID: 'alice', name: 'facet-window-1' }));
        await ra.insert(folderNode({ id: 'p2', ownerID: 'alice', name: 'facet-window-2' }));
        await ra.insert(folderNode({ id: 'p3', ownerID: 'bob', name: 'facet-window-3' }));
        await seedShare('p3', 'alice', 'viewer');

        const firstPage = await search('alice', 'facet-window', 2, 0);
        const secondPage = await search('alice', 'facet-window', 2, 2);

        expect(firstPage.nodes.map((node) => node.id)).toEqual([ 'p1', 'p2' ]);
        expect(firstPage.owners.map((owner) => owner.id)).toEqual([ 'alice' ]);

        expect(secondPage.nodes.map((node) => node.id)).toEqual([ 'p3' ]);
        expect(secondPage.owners.map((owner) => owner.id)).toEqual([ 'bob' ]);
    });

    // A link's row is owned by whoever placed it (alice), but it displays bob's ownership of the target -- so the
    // facet must offer bob even though nothing of bob's own directly matches the search term.
    it('adds a matched link\'s resolved target owner to the facet', async () =>
    {
        await ra.insert(folderNode({ id: 'bobtarget', ownerID: 'bob', name: 'unrelated-name' }));
        await seedShare('bobtarget', 'alice', 'viewer');
        await ra.insert(linkNode({ id: 'lnk', ownerID: 'alice', targetNodeID: 'bobtarget', name: 'facet-link-match' }));

        const result = await search('alice', 'facet-link-match');

        expect(idsOf(result.nodes)).toEqual([ 'lnk' ]);
        expect(result.owners.map((owner) => owner.id).sort()).toEqual([ 'alice', 'bob' ]);
    });
});

//----------------------------------------------------------------------------------------------------------------------
// Locations -- where each hit lives, cut to the ancestry the caller may see
//----------------------------------------------------------------------------------------------------------------------

describe('NodeManager.search locations', () =>
{
    // Alice's tree: Personal / Finance / Team Docs / budget-report.pdf, with only Team Docs shared to bob.
    async function seedSharedTree() : Promise<void>
    {
        await ra.insert(folderNode({ id: 'personal', ownerID: 'alice', name: 'Personal' }));
        await ra.insert(folderNode({ id: 'finance', ownerID: 'alice', parentID: 'personal', name: 'Finance' }));
        await ra.insert(folderNode({ id: 'team', ownerID: 'alice', parentID: 'finance', name: 'Team Docs' }));
        await ra.insert(fileNode({
            id: 'budget', ownerID: 'alice', parentID: 'team', blobID: 'sha-a', name: 'budget-report.pdf',
        }));

        await seedShare('team', 'bob', 'viewer');
    }

    // The case the whole feature turns on: a grantee reaching a file deep inside someone else's tree learns where it
    // sits RELATIVE TO THE SHARE, and learns nothing about the folders the owner kept to themselves.
    it('stops a grantee\'s location at the share root, never naming the owner\'s folders above it', async () =>
    {
        await seedSharedTree();

        const result = await search('bob', 'budget-report');

        expect(idsOf(result.nodes)).toEqual([ 'budget' ]);
        expect(crumbNamesOf(result, 'budget')).toEqual([ 'Team Docs' ]);
        expect(result.locations['budget']?.foreign).toBe(true);
    });

    // The same file, searched by its owner, is the control: nothing is cut, so the full path renders root-first and
    // roots in their own tree.
    it('gives the owner of that same file its whole chain, rooted in their own tree', async () =>
    {
        await seedSharedTree();

        const result = await search('alice', 'budget-report');

        expect(crumbNamesOf(result, 'budget')).toEqual([ 'Personal', 'Finance', 'Team Docs' ]);
        expect(result.locations['budget']?.foreign).toBe(false);
    });

    // A share on the file itself reaches the file and nothing else, so there is no containing folder to name -- but the
    // location must still say the file lives outside the caller's own tree.
    it('reports an empty foreign location when only the file itself is shared', async () =>
    {
        await ra.insert(folderNode({ id: 'vault', ownerID: 'alice', name: 'Vault' }));
        await ra.insert(fileNode({
            id: 'lone', ownerID: 'alice', parentID: 'vault', blobID: 'sha-a', name: 'lone-report',
        }));
        await seedShare('lone', 'bob', 'viewer');

        const result = await search('bob', 'lone-report');

        expect(crumbNamesOf(result, 'lone')).toEqual([]);
        expect(result.locations['lone']?.foreign).toBe(true);
    });

    // A node at the caller's own root has nothing above it, which is their files root rather than an unknown place.
    it('reports an empty own-tree location for a node at the caller\'s root', async () =>
    {
        await ra.insert(fileNode({ id: 'top', ownerID: 'alice', blobID: 'sha-a', name: 'top-report' }));

        const result = await search('alice', 'top-report');

        expect(crumbNamesOf(result, 'top')).toEqual([]);
        expect(result.locations['top']?.foreign).toBe(false);
    });

    // Every row the page returns is renderable: a hit without a location would leave the results surface with nothing
    // to draw under the name.
    it('carries a location for every node on the page and none for nodes off it', async () =>
    {
        await ra.insert(folderNode({ id: 'box', ownerID: 'alice', name: 'Box' }));
        await ra.insert(fileNode({ id: 'm1', ownerID: 'alice', parentID: 'box', blobID: 'sha-a', name: 'many-1' }));
        await ra.insert(fileNode({ id: 'm2', ownerID: 'alice', parentID: 'box', blobID: 'sha-a', name: 'many-2' }));
        await ra.insert(fileNode({ id: 'm3', ownerID: 'alice', parentID: 'box', blobID: 'sha-a', name: 'many-3' }));

        const firstPage = await search('alice', 'many-', 2, 0);

        expect(firstPage.nodes.map((node) => node.id)).toEqual([ 'm1', 'm2' ]);
        expect(Object.keys(firstPage.locations).sort()).toEqual([ 'm1', 'm2' ]);
        expect(crumbNamesOf(firstPage, 'm1')).toEqual([ 'Box' ]);
    });

    // A location names folders, and folders are reached by parent edges alone. A link pointing into a shared folder is
    // not a way to inherit that folder's ancestry, so a matched link reports its OWN placement.
    it('locates a matched link by its own placement rather than its target\'s', async () =>
    {
        await ra.insert(folderNode({ id: 'shelf', ownerID: 'alice', name: 'Shelf' }));
        await ra.insert(folderNode({ id: 'far', ownerID: 'alice', name: 'Far Away' }));
        await ra.insert(fileNode({ id: 'tgt', ownerID: 'alice', parentID: 'far', blobID: 'sha-a', name: 'target' }));
        await ra.insert(linkNode({
            id: 'shortcut', ownerID: 'alice', parentID: 'shelf', targetNodeID: 'tgt', name: 'linked-report',
        }));

        const result = await search('alice', 'linked-report');

        expect(crumbNamesOf(result, 'shortcut')).toEqual([ 'Shelf' ]);
    });
});

//----------------------------------------------------------------------------------------------------------------------
