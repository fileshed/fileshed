//----------------------------------------------------------------------------------------------------------------------
// ShareRA — row surface
//
// Drives the share and share_request row methods against a real in-memory SQLite database (production factory +
// migrator, zero mocks). Expectations: a grant is (node, grantee, role, created_by), one per pair; requests route
// to the target's owner and resolution stamps status + resolved_at together; and Shared with me lists active shares
// with a placement flag, hiding a trashed target.
//----------------------------------------------------------------------------------------------------------------------

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { Kysely } from 'kysely';

// Models
import type { PendingShareRequest, Share, ShareRole } from '@fileshed/core';

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
    await seedUser(db, 'other');
    await seedUser(db, 'grantee');
    await seedUser(db, 'requester');
    await seedBackend(db, 'be1');
    await seedBlob(db, 'sha-a', 'be1');
});

afterEach(async () =>
{
    await db.destroy();
});

const createdAt = new Date('2026-02-01T00:00:00.000Z');

function shareOf(id : string, nodeID : string, granteeUserID : string, role : ShareRole) : Share
{
    return { id, nodeID, granteeUserID, role, createdBy: 'owner', createdAt };
}

function pendingRequest(id : string, nodeID : string, requesterID : string, role : ShareRole) : PendingShareRequest
{
    return { id, nodeID, requesterID, requestedRole: role, status: 'pending', resolvedAt: null, createdAt };
}

//----------------------------------------------------------------------------------------------------------------------
// Share rows
//----------------------------------------------------------------------------------------------------------------------

describe('ShareRA share rows', () =>
{
    it('round-trips a new grant through the row<->domain boundary', async () =>
    {
        await nodes.insert(folderNode({ id: 'f', ownerID: 'owner' }));
        const share = shareOf('s1', 'f', 'grantee', 'viewer');

        expect(await shares.upsertShare(share)).toEqual(share);
        expect(await shares.getShareById('s1')).toEqual(share);
    });

    it('finds a grant by (node, grantee) and returns undefined when there is none', async () =>
    {
        await nodes.insert(folderNode({ id: 'f', ownerID: 'owner' }));
        await shares.upsertShare(shareOf('s1', 'f', 'grantee', 'editor'));

        expect((await shares.getShareByNodeGrantee('f', 'grantee'))?.role).toBe('editor');
        expect(await shares.getShareByNodeGrantee('f', 'other')).toBeUndefined();
    });

    // A second grant to the same grantee must land as an UPDATE on the one row the UNIQUE (node_id, grantee_user_id)
    // constraint allows -- never a second insert that trips it. The surviving row keeps its original id and
    // provenance, so a role change does not re-issue the grant.
    it('re-granting the same grantee updates the one row in place instead of conflicting', async () =>
    {
        await nodes.insert(folderNode({ id: 'f', ownerID: 'owner' }));
        await shares.upsertShare(shareOf('s1', 'f', 'grantee', 'viewer'));

        const regranted = await shares.upsertShare(shareOf('s2-ignored', 'f', 'grantee', 'editor'));

        expect(regranted.id).toBe('s1');
        expect(regranted.role).toBe('editor');
        expect(await shares.listByNode('f')).toHaveLength(1);
        expect(await shares.getShareById('s2-ignored')).toBeUndefined();
    });

    it('reports whether a delete removed a row (the revoke 404 signal)', async () =>
    {
        await nodes.insert(folderNode({ id: 'f', ownerID: 'owner' }));
        await shares.upsertShare(shareOf('s1', 'f', 'grantee', 'viewer'));

        expect(await shares.deleteShare('s1')).toBe(true);
        expect(await shares.deleteShare('s1')).toBe(false);
    });

    it('lists every grant on a node for the owner view', async () =>
    {
        await nodes.insert(folderNode({ id: 'f', ownerID: 'owner' }));
        await shares.upsertShare({ ...shareOf('s1', 'f', 'grantee', 'viewer'), createdAt: new Date('2026-02-01') });
        await shares.upsertShare({ ...shareOf('s2', 'f', 'other', 'editor'), createdAt: new Date('2026-02-02') });

        const listed = await shares.listByNode('f');

        expect(listed.map((share) => share.granteeUserID)).toEqual([ 'grantee', 'other' ]);
    });
});

//----------------------------------------------------------------------------------------------------------------------
// Shared with me
//----------------------------------------------------------------------------------------------------------------------

describe('ShareRA.sharedWithMe', () =>
{
    it('lists an active share with its target summary and placed=false when no link is held', async () =>
    {
        await nodes.insert(fileNode({
            id: 'doc',
            ownerID: 'owner',
            blobID: 'sha-a',
            size: 42,
            mimeType: 'text/plain',
        }));
        await shares.upsertShare(shareOf('s1', 'doc', 'grantee', 'viewer'));

        const [ entry ] = await shares.sharedWithMe('grantee');

        expect(entry.share.id).toBe('s1');
        expect(entry.target).toEqual({
            id: 'doc',
            type: 'file',
            name: 'doc',
            ownerID: 'owner',
            mimeType: 'text/plain',
            size: 42,
        });
        expect(entry.placed).toBe(false);
    });

    it('reports placed=true when the grantee holds a link to the shared target', async () =>
    {
        await nodes.insert(fileNode({ id: 'doc', ownerID: 'owner', blobID: 'sha-a' }));
        await shares.upsertShare(shareOf('s1', 'doc', 'grantee', 'viewer'));
        await nodes.insert(linkNode({ id: 'lk', ownerID: 'grantee', targetNodeID: 'doc' }));

        const [ entry ] = await shares.sharedWithMe('grantee');

        expect(entry.placed).toBe(true);
    });

    it('hides a share whose target the owner has trashed', async () =>
    {
        await nodes.insert(fileNode({ id: 'live', ownerID: 'owner', blobID: 'sha-a' }));
        await nodes.insert(fileNode({ id: 'gone', ownerID: 'owner', blobID: 'sha-a' }));
        await shares.upsertShare(shareOf('s1', 'live', 'grantee', 'viewer'));
        await shares.upsertShare(shareOf('s2', 'gone', 'grantee', 'viewer'));
        await nodes.setTrashed('gone', new Date('2026-03-01T00:00:00.000Z'));

        const entries = await shares.sharedWithMe('grantee');

        expect(entries.map((entry) => entry.target.id)).toEqual([ 'live' ]);
    });
});

//----------------------------------------------------------------------------------------------------------------------
// Share request rows
//----------------------------------------------------------------------------------------------------------------------

describe('ShareRA share request rows', () =>
{
    it('inserts a pending request and reads it back as pending with no resolution', async () =>
    {
        await nodes.insert(folderNode({ id: 'f', ownerID: 'owner' }));
        const request = pendingRequest('r1', 'f', 'requester', 'viewer');
        await shares.insertRequest(request);

        expect(await shares.getRequestById('r1')).toEqual(request);
    });

    it('resolves a request by stamping status and resolved_at together', async () =>
    {
        await nodes.insert(folderNode({ id: 'f', ownerID: 'owner' }));
        await shares.insertRequest(pendingRequest('r1', 'f', 'requester', 'editor'));
        const resolvedAt = new Date('2026-04-01T00:00:00.000Z');

        await shares.resolveRequest('r1', 'granted', resolvedAt);

        const resolved = await shares.getRequestById('r1');
        expect(resolved?.status).toBe('granted');
        expect(resolved?.resolvedAt).toEqual(resolvedAt);
    });

    it('routes pending requests to the target owner, excluding requests on other owners\' nodes', async () =>
    {
        await nodes.insert(folderNode({ id: 'mine', ownerID: 'owner' }));
        await nodes.insert(folderNode({ id: 'theirs', ownerID: 'other' }));
        await shares.insertRequest(pendingRequest('r1', 'mine', 'requester', 'viewer'));
        await shares.insertRequest(pendingRequest('r2', 'theirs', 'requester', 'viewer'));

        const incoming = await shares.listPendingByOwner('owner');

        expect(incoming.map((request) => request.id)).toEqual([ 'r1' ]);
    });

    it('omits an already-resolved request from the owner\'s pending list', async () =>
    {
        await nodes.insert(folderNode({ id: 'f', ownerID: 'owner' }));
        await shares.insertRequest(pendingRequest('r1', 'f', 'requester', 'viewer'));
        await shares.resolveRequest('r1', 'declined', new Date('2026-04-01T00:00:00.000Z'));

        expect(await shares.listPendingByOwner('owner')).toEqual([]);
    });

    it('finds a pending request on a node, and stops finding it once resolved (duplicate guard)', async () =>
    {
        await nodes.insert(folderNode({ id: 'f', ownerID: 'owner' }));
        await shares.insertRequest(pendingRequest('r1', 'f', 'requester', 'viewer'));

        expect((await shares.findPendingByNodeRequester('f', 'requester'))?.id).toBe('r1');

        await shares.resolveRequest('r1', 'granted', new Date('2026-04-01T00:00:00.000Z'));

        expect(await shares.findPendingByNodeRequester('f', 'requester')).toBeUndefined();
    });

    it('lists a requester\'s own requests across statuses', async () =>
    {
        await nodes.insert(folderNode({ id: 'a', ownerID: 'owner' }));
        await nodes.insert(folderNode({ id: 'b', ownerID: 'owner' }));
        const earlier = { ...pendingRequest('r1', 'a', 'requester', 'viewer'), createdAt: new Date('2026-02-01') };
        const later = { ...pendingRequest('r2', 'b', 'requester', 'editor'), createdAt: new Date('2026-02-02') };
        await shares.insertRequest(earlier);
        await shares.insertRequest(later);
        await shares.resolveRequest('r2', 'declined', new Date('2026-04-01T00:00:00.000Z'));

        const outgoing = await shares.listByRequester('requester');

        expect(outgoing.map((request) => request.status)).toEqual([ 'pending', 'declined' ]);
    });
});

//----------------------------------------------------------------------------------------------------------------------
