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
import type { NodeListResponse, NodeResponse } from '@fileshed/core';

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
    seedBackend,
    seedBlob,
    seedUser,
} from '../resource-access/nodes/support.ts';
import { noopOrphanedBlobs, testActor } from '../nodes/support.ts';

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
    return new NodeManager(handle, ra, noopOrphanedBlobs());
}

function search(actorID : string, term : string, limit = 50, offset = 0) : Promise<NodeListResponse>
{
    // eslint-disable-next-line id-length -- `q` is the search DTO's wire field name
    return manager().search(testActor({ id: actorID }), { q: term, limit, offset });
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
