//----------------------------------------------------------------------------------------------------------------------
// Deletion Offers — minting on hard delete, list/accept/decline
//
// Drives NodeManager.hardDelete's recipients-may-copy branch and the DeletionOfferManager against a real NodeRA,
// ShareRA, DeletionOfferRA, and BlobRA over in-memory SQLite (zero mocks below the RA seam, real FK enforcement).
// The blob collaborator is a real BlobRA so deletes genuinely graveyard and accepts genuinely resurrect.
//----------------------------------------------------------------------------------------------------------------------

/* eslint-disable camelcase -- seeds and state reads name snake_case DB columns (house convention for Kysely) */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

// Models
import { type DeletionOffer, ForbiddenError, NotFoundError, RegulationError } from '@fileshed/core';

// Resource Access
import { BlobRA } from '@server/resource-access/blob/index.ts';
import type { DatabaseHandle } from '@server/resource-access/database/database.ts';
import { DeletionOfferRA } from '@server/resource-access/deletionOffers/index.ts';
import { NodeRA } from '@server/resource-access/nodes/node.ts';

// Managers
import { DeletionOfferManager } from '@server/managers/deletionOffer.ts';
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
    setUserQuota,
} from '../resource-access/nodes/support.ts';
import { testActor, testNodePolicy } from '../nodes/support.ts';

//----------------------------------------------------------------------------------------------------------------------

const GRACE_MS = 60_000;

let handle : DatabaseHandle;
let ra : NodeRA;
let offerRA : DeletionOfferRA;
let nodes : NodeManager;
let offers : DeletionOfferManager;

beforeEach(async () =>
{
    handle = await createTestDatabase();
    ra = new NodeRA(handle);
    offerRA = new DeletionOfferRA(handle);
    nodes = new NodeManager(handle, ra, new BlobRA(handle), testNodePolicy({ offerGraceMs: async () => GRACE_MS }));
    offers = new DeletionOfferManager(handle, nodes);

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
// Seeds & state readers
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

// A shared file ready to delete: alice owns folder `dir` (shared to bob) holding file `doc` (directly shared to
// carol). Both grants reach the file -- bob through the ancestor, carol directly.
async function seedSharedFile() : Promise<void>
{
    await ra.insert(folderNode({ id: 'dir', ownerID: 'alice' }));
    await ra.insert(fileNode({ id: 'doc', ownerID: 'alice', parentID: 'dir', blobID: 'sha-a', name: 'report.pdf' }));
    await seedShare('dir', 'bob', 'viewer');
    await seedShare('doc', 'carol', 'viewer');
}

async function offerRows() : Promise<{ offeree_id : string, name : string, sha256 : string }[]>
{
    return handle.db
        .selectFrom('deletion_offer')
        .select([ 'offeree_id', 'name', 'sha256' ])
        .orderBy('offeree_id')
        .execute();
}

async function blobDeletedAt(sha256 : string) : Promise<string | Date | null>
{
    const row = await handle.db.selectFrom('blob').select('deleted_at')
        .where('sha256', '=', sha256)
        .executeTakeFirstOrThrow();
    return row.deleted_at;
}

async function seedOffer(init : Partial<DeletionOffer> = {}) : Promise<string>
{
    const id = init.id ?? 'offer-1';
    await offerRA.insertMany([ {
        id,
        sha256: 'sha-a',
        offereeID: 'bob',
        name: 'report.pdf',
        mimeType: 'application/pdf',
        size: 10,
        createdBy: 'alice',
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + GRACE_MS),
        ...init,
    } ]);
    return id;
}

async function caught(promise : Promise<unknown>) : Promise<unknown>
{
    return promise.then(() => { throw new Error('expected a rejection'); }, (error : unknown) => error);
}

//----------------------------------------------------------------------------------------------------------------------

describe('NodeManager.hardDelete offer minting', () =>
{
    it('mints one offer per user the file was visible to through a share, excluding the owner', async () =>
    {
        await seedSharedFile();

        await nodes.hardDelete(testActor({ id: 'alice' }), 'doc', { offerCopies: true });

        const rows = await offerRows();
        expect(rows).toEqual([
            { offeree_id: 'bob', name: 'report.pdf', sha256: 'sha-a' },
            { offeree_id: 'carol', name: 'report.pdf', sha256: 'sha-a' },
        ]);

        // The delete itself happened, and the now-unreferenced blob is graveyarded pending GC.
        expect(await ra.get('doc')).toBeUndefined();
        expect(await blobDeletedAt('sha-a')).not.toBeNull();
    });

    it('stamps the offer expiry with the GC grace window', async () =>
    {
        await seedSharedFile();
        const before = Date.now();

        await nodes.hardDelete(testActor({ id: 'alice' }), 'doc', { offerCopies: true });

        const row = await handle.db.selectFrom('deletion_offer').select('expires_at')
            .where('offeree_id', '=', 'bob')
            .executeTakeFirstOrThrow();
        const expiresAt = new Date(row.expires_at).getTime();

        expect(expiresAt).toBeGreaterThanOrEqual(before + GRACE_MS);
        expect(expiresAt).toBeLessThanOrEqual(Date.now() + GRACE_MS);
    });

    it('mints nothing without the opt-in', async () =>
    {
        await seedSharedFile();

        await nodes.hardDelete(testActor({ id: 'alice' }), 'doc');

        expect(await offerRows()).toEqual([]);
    });

    it('mints nothing for a file nobody holds a share on', async () =>
    {
        await ra.insert(fileNode({ id: 'solo', ownerID: 'alice', blobID: 'sha-a' }));

        await nodes.hardDelete(testActor({ id: 'alice' }), 'solo', { offerCopies: true });

        expect(await offerRows()).toEqual([]);
    });

    it('ignores the opt-in on a folder delete', async () =>
    {
        await seedSharedFile();

        await nodes.hardDelete(testActor({ id: 'alice' }), 'dir', { offerCopies: true });

        expect(await offerRows()).toEqual([]);
    });

    it('ignores the opt-in on a link delete, leaving the target untouched', async () =>
    {
        await seedSharedFile();
        await ra.insert(linkNode({ id: 'lnk', ownerID: 'carol', targetNodeID: 'doc' }));

        await nodes.hardDelete(testActor({ id: 'carol' }), 'lnk', { offerCopies: true });

        expect(await offerRows()).toEqual([]);
        expect(await ra.get('doc')).toBeDefined();
    });
});

//----------------------------------------------------------------------------------------------------------------------

describe('DeletionOfferManager', () =>
{
    it('lists only the caller\'s unexpired offers', async () =>
    {
        await seedOffer({ id: 'mine' });
        await seedOffer({ id: 'theirs', offereeID: 'carol' });
        await seedOffer({ id: 'stale', expiresAt: new Date(Date.now() - 1000) });

        const listed = await offers.list(testActor({ id: 'bob' }));

        expect(listed.offers.map((offer) => offer.id)).toEqual([ 'mine' ]);
    });

    it('accepts into an owned live node, resurrecting the blob and consuming the offer', async () =>
    {
        await seedSharedFile();
        await nodes.hardDelete(testActor({ id: 'alice' }), 'doc', { offerCopies: true });
        const offerID = (await handle.db.selectFrom('deletion_offer').select('id')
            .where('offeree_id', '=', 'bob')
            .executeTakeFirstOrThrow()).id;

        const node = await offers.accept(testActor({ id: 'bob' }), offerID, { parentID: null });

        expect(node).toMatchObject({
            type: 'file',
            ownerID: 'bob',
            parentID: null,
            name: 'report.pdf',
            role: 'owner',
            trashedAt: null,
        });
        expect((node as { blobID : string }).blobID).toBe('sha-a');

        expect(await blobDeletedAt('sha-a')).toBeNull();
        expect(await handle.db.selectFrom('deletion_offer').select('id')
            .where('id', '=', offerID)
            .executeTakeFirst()).toBeUndefined();
    });

    it('honors a rename on accept', async () =>
    {
        const offerID = await seedOffer();

        const node = await offers.accept(testActor({ id: 'bob' }), offerID, { parentID: null, name: 'saved.pdf' });

        expect(node.name).toBe('saved.pdf');
    });

    it('refuses placement into a folder the offeree only views', async () =>
    {
        await ra.insert(folderNode({ id: 'foreign', ownerID: 'carol' }));
        await seedShare('foreign', 'bob', 'viewer');
        const offerID = await seedOffer();

        const error = await caught(offers.accept(testActor({ id: 'bob' }), offerID, { parentID: 'foreign' }));

        expect(error).toBeInstanceOf(RegulationError);
        expect(await offerRows()).toHaveLength(1);
    });

    it('rejects an accept that would exceed the offeree\'s quota, keeping the offer and the graveyard', async () =>
    {
        await seedSharedFile();
        await nodes.hardDelete(testActor({ id: 'alice' }), 'doc', { offerCopies: true });
        const offerID = (await handle.db.selectFrom('deletion_offer').select('id')
            .where('offeree_id', '=', 'bob')
            .executeTakeFirstOrThrow()).id;

        await setUserQuota(handle.db, 'bob', 5);

        const error = await caught(offers.accept(testActor({ id: 'bob' }), offerID, { parentID: null }));

        // The rejection rolls the whole transaction back: the offer survives for a retry after the offeree frees
        // space, and the blob stays graveyarded -- nothing durable happened.
        expect(error).toBeInstanceOf(ForbiddenError);
        expect(await handle.db.selectFrom('deletion_offer').select('id')
            .where('id', '=', offerID)
            .executeTakeFirst()).toBeDefined();
        expect(await blobDeletedAt('sha-a')).not.toBeNull();
        expect(await ra.ownedBytes('bob')).toBe(0);
    });

    it('declines by discarding the offer without creating anything', async () =>
    {
        const offerID = await seedOffer();

        await offers.decline(testActor({ id: 'bob' }), offerID);

        expect(await offerRows()).toEqual([]);
        expect(await ra.ownedBytes('bob')).toBe(0);
    });

    it('treats another user\'s offer as absent for accept and decline alike', async () =>
    {
        const offerID = await seedOffer();

        expect(await caught(offers.accept(testActor({ id: 'carol' }), offerID, { parentID: null })))
            .toBeInstanceOf(NotFoundError);
        expect(await caught(offers.decline(testActor({ id: 'carol' }), offerID)))
            .toBeInstanceOf(NotFoundError);
        expect(await offerRows()).toHaveLength(1);
    });

    it('treats an expired offer as absent', async () =>
    {
        const offerID = await seedOffer({ expiresAt: new Date(Date.now() - 1000) });

        expect(await caught(offers.accept(testActor({ id: 'bob' }), offerID, { parentID: null })))
            .toBeInstanceOf(NotFoundError);
    });

    // GC is row-first and the offer's sha256 cascades from the blob row, so collected offers vanish with the blob --
    // there is no window where an offer promises bytes the store no longer records.
    it('loses its offers when the blob row is hard-deleted', async () =>
    {
        await seedSharedFile();
        await nodes.hardDelete(testActor({ id: 'alice' }), 'doc', { offerCopies: true });

        await handle.db.deleteFrom('blob').where('sha256', '=', 'sha-a')
            .execute();

        expect(await offerRows()).toEqual([]);
    });
});

//----------------------------------------------------------------------------------------------------------------------
