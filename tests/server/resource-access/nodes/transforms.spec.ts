//----------------------------------------------------------------------------------------------------------------------
// Node Transforms — row <-> domain
//
// rowFromNode/nodeFromRow are the boundary between the node table and the Node union (@fileshed/core). The round-trip
// tests drive real columns -- insert the row rowFromNode produces, read it back, and require nodeFromRow to reconstruct
// the exact domain node -- so the column mapping and the dialect timestamp normalization both get exercised. The
// corruption tests hand nodeFromRow rows the CHECK constraint would never allow and require a typed throw rather than a
// silent coercion.
//----------------------------------------------------------------------------------------------------------------------

/* eslint-disable camelcase -- corruption fixtures build snake_case DB rows directly */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { Kysely, Selectable } from 'kysely';

// Models
import { NodeRowCorruptionError } from '@fileshed/core';

// Resource Access
import type { Database, DatabaseHandle, NodeTable } from '@server/resource-access/database/database.ts';
import { nodeFromRow, rowFromNode } from '@server/resource-access/nodes/transforms.ts';

// Support
import { createTestDatabase, fileNode, folderNode, linkNode, seedBackend, seedBlob, seedUser } from './support.ts';

//----------------------------------------------------------------------------------------------------------------------

let handle : DatabaseHandle;
let db : Kysely<Database>;

beforeEach(async () =>
{
    handle = await createTestDatabase();
    db = handle.db;
    await seedUser(db, 'u1');
    await seedBackend(db, 'be1');
    await seedBlob(db, 'sha-a', 'be1');
});

afterEach(async () =>
{
    await db.destroy();
});

// Round-trip a node through the real columns: write what rowFromNode produces, read it back, reconstruct.
async function roundTrip(id : string) : Promise<ReturnType<typeof nodeFromRow>>
{
    const row = await db
        .selectFrom('node')
        .selectAll()
        .where('id', '=', id)
        .executeTakeFirstOrThrow();

    return nodeFromRow(row);
}

//----------------------------------------------------------------------------------------------------------------------

describe('node transforms round-trip', () =>
{
    it('round-trips a file node, preserving blob, size, mime type and trashed_at', async () =>
    {
        const node = fileNode({
            id: 'f1',
            ownerID: 'u1',
            blobID: 'sha-a',
            size: 4096,
            mimeType: 'application/pdf',
            trashedAt: new Date('2026-02-03T04:05:06.000Z'),
        });

        await db.insertInto('node').values(rowFromNode(node))
            .execute();

        expect(await roundTrip('f1')).toEqual(node);
    });

    it('round-trips a folder node', async () =>
    {
        const node = folderNode({ id: 'd1', ownerID: 'u1', parentID: null });

        await db.insertInto('node').values(rowFromNode(node))
            .execute();

        expect(await roundTrip('d1')).toEqual(node);
    });

    it('round-trips a link node, carrying only its target', async () =>
    {
        const target = folderNode({ id: 'd1', ownerID: 'u1' });
        const node = linkNode({ id: 'l1', ownerID: 'u1', targetNodeID: 'd1' });

        await db.insertInto('node').values(rowFromNode(target))
            .execute();
        await db.insertInto('node').values(rowFromNode(node))
            .execute();

        expect(await roundTrip('l1')).toEqual(node);
    });
});

//----------------------------------------------------------------------------------------------------------------------

// A structurally valid file row, cloned and mutated per case to violate exactly one variant invariant.
function fileRow() : Selectable<NodeTable>
{
    return {
        id: 'x1',
        type: 'file',
        name: 'x1',
        owner_id: 'u1',
        parent_id: null,
        blob_id: 'sha-a',
        target_node_id: null,
        size: 10,
        mime_type: 'text/plain',
        created_at: '2026-01-02T03:04:05.678Z',
        updated_at: '2026-01-02T03:04:05.678Z',
        trashed_at: null,
    };
}

describe('nodeFromRow corruption detection', () =>
{
    it('throws when a file row has no blob (the CHECK would never allow it)', () =>
    {
        const row : Selectable<NodeTable> = { ...fileRow(), blob_id: null };

        expect(() => nodeFromRow(row)).toThrow(NodeRowCorruptionError);
    });

    it('throws when a folder row carries a size', () =>
    {
        const row : Selectable<NodeTable> = { ...fileRow(), type: 'folder', blob_id: null, mime_type: null, size: 10 };

        expect(() => nodeFromRow(row)).toThrow(NodeRowCorruptionError);
    });

    it('throws when a link row carries a blob', () =>
    {
        const row : Selectable<NodeTable> = { ...fileRow(), type: 'link', target_node_id: 'd1', blob_id: 'sha-a' };

        expect(() => nodeFromRow(row)).toThrow(NodeRowCorruptionError);
    });

    it('throws when a link row carries a trashed_at (links are never trashed)', () =>
    {
        const row : Selectable<NodeTable> = {
            ...fileRow(),
            type: 'link',
            target_node_id: 'd1',
            blob_id: null,
            size: null,
            mime_type: null,
            trashed_at: '2026-02-03T04:05:06.000Z',
        };

        expect(() => nodeFromRow(row)).toThrow(NodeRowCorruptionError);
    });
});

//----------------------------------------------------------------------------------------------------------------------
