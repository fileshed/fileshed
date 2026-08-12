//----------------------------------------------------------------------------------------------------------------------
// PublicLinkRA — the live-link lookup a listing runs over a whole page
//
// Drives liveLinksByNode against a real in-memory SQLite database (production factory + migrator, zero mocks).
// Expectations: a link is live until it is revoked, the answer is keyed by node so a page of rows resolves in one
// pass, and a node carrying several live links answers with the oldest -- the same one the link listing shows first.
//----------------------------------------------------------------------------------------------------------------------

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { Kysely } from 'kysely';

// Models
import type { PublicLink } from '@fileshed/core';

// Resource Access
import type { Database, DatabaseHandle } from '@server/resource-access/database/database.ts';
import { NodeRA } from '@server/resource-access/nodes/node.ts';
import { PublicLinkRA } from '@server/resource-access/publicLinks/index.ts';

// Support
import { createTestDatabase, fileNode, seedBackend, seedBlob, seedUser } from '../nodes/support.ts';

//----------------------------------------------------------------------------------------------------------------------

let handle : DatabaseHandle;
let db : Kysely<Database>;
let nodes : NodeRA;
let links : PublicLinkRA;

beforeEach(async () =>
{
    handle = await createTestDatabase();
    db = handle.db;
    nodes = new NodeRA(handle);
    links = new PublicLinkRA(handle);

    await seedUser(db, 'owner');
    await seedBackend(db, 'be1');
    await seedBlob(db, 'sha-a', 'be1');
});

afterEach(async () =>
{
    await db.destroy();
});

function link(init : { id : string; nodeID : string; createdAt : Date; revokedAt ?: Date | null }) : PublicLink
{
    return {
        id: init.id,
        nodeID: init.nodeID,
        token: `token-${ init.id }`,
        createdAt: init.createdAt,
        revokedAt: init.revokedAt ?? null,
    };
}

//----------------------------------------------------------------------------------------------------------------------

describe('PublicLinkRA.liveLinksByNode', () =>
{
    it('answers with the live link on each node asked about, keyed by node', async () =>
    {
        await nodes.insert(fileNode({ id: 'a', ownerID: 'owner', blobID: 'sha-a' }));
        await nodes.insert(fileNode({ id: 'b', ownerID: 'owner', blobID: 'sha-a' }));
        await links.insert(link({ id: 'l1', nodeID: 'a', createdAt: new Date('2026-03-01T00:00:00.000Z') }));
        await links.insert(link({ id: 'l2', nodeID: 'b', createdAt: new Date('2026-03-02T00:00:00.000Z') }));

        const found = await links.liveLinksByNode([ 'a', 'b' ]);

        expect(found.get('a')?.token).toBe('token-l1');
        expect(found.get('b')?.token).toBe('token-l2');
    });

    it('leaves a node with no link at all out of the map', async () =>
    {
        await nodes.insert(fileNode({ id: 'a', ownerID: 'owner', blobID: 'sha-a' }));

        expect((await links.liveLinksByNode([ 'a' ])).has('a')).toBe(false);
    });

    // The whole reason this is derived rather than stored: revoking kills the capability, so the node stops reading
    // as published from that instant. A revoked link still resolves by token (to a dead link) but is never live.
    it('does not count a revoked link as live', async () =>
    {
        await nodes.insert(fileNode({ id: 'a', ownerID: 'owner', blobID: 'sha-a' }));
        await links.insert(link({ id: 'l1', nodeID: 'a', createdAt: new Date('2026-03-01T00:00:00.000Z') }));

        await links.revoke('l1');
        const found = await links.liveLinksByNode([ 'a' ]);

        expect(found.has('a')).toBe(false);
    });

    // The API allows several links per node, so the answer has to be deterministic: the oldest live one, which is the
    // link the node's own listing presents first.
    it('answers with the oldest live link when a node carries more than one', async () =>
    {
        await nodes.insert(fileNode({ id: 'a', ownerID: 'owner', blobID: 'sha-a' }));
        await links.insert(link({ id: 'older', nodeID: 'a', createdAt: new Date('2026-03-01T00:00:00.000Z') }));
        await links.insert(link({ id: 'newer', nodeID: 'a', createdAt: new Date('2026-03-05T00:00:00.000Z') }));

        expect((await links.liveLinksByNode([ 'a' ])).get('a')?.id).toBe('older');
    });

    // A revoked link never stands in for a live one, whichever came first.
    it('skips past a revoked older link to the live one behind it', async () =>
    {
        await nodes.insert(fileNode({ id: 'a', ownerID: 'owner', blobID: 'sha-a' }));
        await links.insert(link({ id: 'older', nodeID: 'a', createdAt: new Date('2026-03-01T00:00:00.000Z') }));
        await links.insert(link({ id: 'newer', nodeID: 'a', createdAt: new Date('2026-03-05T00:00:00.000Z') }));

        await links.revoke('older');

        expect((await links.liveLinksByNode([ 'a' ])).get('a')?.id).toBe('newer');
    });

    it('asks nothing of the database for an empty page', async () =>
    {
        expect(await links.liveLinksByNode([])).toEqual(new Map());
    });
});

//----------------------------------------------------------------------------------------------------------------------
