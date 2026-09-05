//----------------------------------------------------------------------------------------------------------------------
// BlobRA row surface — graveyard & GC concurrency mechanics
//
// Drives BlobRA's row surface against a real in-memory database (production factory + migrator, zero mocks), so the
// derived ref-count NOT EXISTS, the ON CONFLICT resurrection, and the conditional GC delete run exactly as deployed.
// Every expectation comes from the graveyard rules -- last-reference-removed graveyards a blob, resurrection clears
// the marker, GC deletes only records still past-cutoff at delete time -- never from what a query happens to return.
//----------------------------------------------------------------------------------------------------------------------

/* eslint-disable camelcase -- seed helpers build snake_case DB rows (house convention for Kysely inserts) */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { Kysely } from 'kysely';

// Resource Access
import { BlobRA } from '@server/resource-access/blob/index.ts';
import type { Database, DatabaseHandle } from '@server/resource-access/database/database.ts';
import { NodeRA } from '@server/resource-access/nodes/node.ts';

// Support
import { createTestDatabase, fileNode, seedBackend, seedUser } from '../nodes/support.ts';

//----------------------------------------------------------------------------------------------------------------------

let handle : DatabaseHandle;
let db : Kysely<Database>;
let ra : BlobRA;

const PAST = new Date('2020-01-01T00:00:00.000Z').toISOString();

async function seedBlobRow(sha256 : string, deletedAt : string | null) : Promise<void>
{
    await db
        .insertInto('blob')
        .values({
            sha256,
            size: 128,
            backend_id: 'be1',
            storage_key: sha256,
            created_at: new Date().toISOString(),
            deleted_at: deletedAt,
        })
        .execute();
}

async function deletedAtOf(sha256 : string) : Promise<Date | null | undefined>
{
    return (await ra.get(sha256))?.deletedAt;
}

beforeEach(async () =>
{
    handle = await createTestDatabase();
    db = handle.db;
    ra = new BlobRA(handle);

    await seedUser(db, 'u1');
    await seedBackend(db, 'be1');
});

afterEach(async () =>
{
    await db.destroy();
});

//----------------------------------------------------------------------------------------------------------------------

describe('BlobRA.graveyardUnreferenced', () =>
{
    it('graveyards an unreferenced blob but leaves a referenced one live', async () =>
    {
        await seedBlobRow('sha-referenced', null);
        await seedBlobRow('sha-orphan', null);
        await new NodeRA(handle).insert(fileNode({ id: 'n1', ownerID: 'u1', blobID: 'sha-referenced' }));

        await ra.graveyardUnreferenced([ 'sha-referenced', 'sha-orphan' ]);

        expect(await deletedAtOf('sha-referenced')).toBeNull();
        expect(await deletedAtOf('sha-orphan')).not.toBeNull();
    });

    it('does not reset the grace clock of an already-graveyarded blob', async () =>
    {
        await seedBlobRow('sha-old', PAST);

        await ra.graveyardUnreferenced([ 'sha-old' ]);

        expect((await deletedAtOf('sha-old'))?.toISOString()).toBe(PAST);
    });
});

//----------------------------------------------------------------------------------------------------------------------

describe('BlobRA resurrection', () =>
{
    it('clears the graveyard marker when insertOrResurrect meets an existing graveyarded record', async () =>
    {
        await seedBlobRow('sha-dead', PAST);

        await ra.insertOrResurrect({ sha256: 'sha-dead', size: 128, backendID: 'be1', storageKey: 'sha-dead' });

        expect(await deletedAtOf('sha-dead')).toBeNull();
    });

    it('inserts a live record when insertOrResurrect meets no existing one', async () =>
    {
        await ra.insertOrResurrect({ sha256: 'sha-new', size: 64, backendID: 'be1', storageKey: 'sha-new' });

        const row = await ra.get('sha-new');
        expect(row?.deletedAt).toBeNull();
        expect(row?.size).toBe(64);
    });

    it('clears the graveyard marker via resurrect', async () =>
    {
        await seedBlobRow('sha-dead', PAST);

        await ra.resurrect('sha-dead');

        expect(await deletedAtOf('sha-dead')).toBeNull();
    });
});

//----------------------------------------------------------------------------------------------------------------------

describe('BlobRA GC selection', () =>
{
    it('lists only records graveyarded before the cutoff', async () =>
    {
        const cutoff = new Date();
        await seedBlobRow('sha-expired', PAST);
        await seedBlobRow('sha-in-grace', new Date(cutoff.getTime() + 60_000).toISOString());
        await seedBlobRow('sha-live', null);

        const candidates = await ra.gcCandidates(cutoff);

        expect(candidates.map((candidate) => candidate.sha256)).toEqual([ 'sha-expired' ]);
    });

    it('hard-deletes a record still past the cutoff and reports the removal', async () =>
    {
        await seedBlobRow('sha-expired', PAST);

        const removed = await ra.hardDeleteRow('sha-expired', new Date());

        expect(removed).toBe(true);
        expect(await ra.get('sha-expired')).toBeUndefined();
    });

    it('does not delete a record resurrected since it became a candidate', async () =>
    {
        // Resurrected (deleted_at cleared) between candidacy and here: the conditional delete must miss.
        await seedBlobRow('sha-saved', null);

        const removed = await ra.hardDeleteRow('sha-saved', new Date());

        expect(removed).toBe(false);
        expect(await ra.get('sha-saved')).toBeDefined();
    });
});

//----------------------------------------------------------------------------------------------------------------------

// Adopting stored bytes nothing accounts for is how they re-enter the graveyard rules instead of getting a second,
// racier way to delete bytes. The insert is the serialization point against a commit publishing the same content, so
// what matters is both what it does to an unknown address and what it refuses to do to a known one.
describe('BlobRA.adoptOrphan', () =>
{
    const orphan = { sha256: 'sha-orphan', size: 128, backendID: 'be1', storageKey: 'sha-orphan' };

    it('graveyards an unknown address, dated when its bytes stopped being relied on', async () =>
    {
        const stoppedAt = new Date(Date.now() - 3_600_000);

        const adopted = await ra.adoptOrphan(orphan, stoppedAt);

        expect(adopted).toBe(true);
        expect(await deletedAtOf('sha-orphan')).toEqual(stoppedAt);
    });

    // The record that beat it is a live blob somebody is using: a commit for the same content got there first, and
    // the caller must be told it did so rather than going on to collect bytes that are now referenced.
    it('refuses an address a record already claims, leaving that record untouched', async () =>
    {
        await seedBlobRow('sha-taken', null);

        const adopted = await ra.adoptOrphan({ ...orphan, sha256: 'sha-taken', storageKey: 'sha-taken' }, new Date());

        expect(adopted).toBe(false);
        expect(await deletedAtOf('sha-taken')).toBeNull();
    });

    // Adoption is what makes a later insertOrResurrect for the same content a resurrection rather than an insert --
    // which is exactly how a commit that lands after the reconciler keeps its bytes.
    it('leaves a record a later commit can resurrect', async () =>
    {
        await ra.adoptOrphan(orphan, new Date(Date.now() - 3_600_000));

        await ra.insertOrResurrect({ sha256: 'sha-orphan', size: 128, backendID: 'be1', storageKey: 'sha-orphan' });

        expect(await deletedAtOf('sha-orphan')).toBeNull();
    });
});

//----------------------------------------------------------------------------------------------------------------------
