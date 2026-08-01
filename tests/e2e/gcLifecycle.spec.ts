//----------------------------------------------------------------------------------------------------------------------
// E2E — The death of a blob: graveyard, restart, forced collection
//
// The full reclamation story across two real processes sharing one database and one blob tree. The staging server holds
// both windows wide open, so everything it stages is guaranteed to outlive it no matter when its own boot sweeps fire:
// a file emptied out of the trash leaves a graveyarded blob whose BYTES ARE STILL ON DISK -- graveyarding is a marker,
// not a delete, and the grace window it opens is the whole point. The sweeping server then boots onto that same state
// with both windows closed to zero, and its boot passes do the reaping the first process never could.
//
// The two boot passes race by design -- both fire a second after start and neither waits on the other -- so the trashed
// file's blob is only asserted as far as that race allows: the purge takes its last reference, and whether the GC pass
// alongside also collected the record depends on which sweep queried first.
//----------------------------------------------------------------------------------------------------------------------

import { setTimeout as sleep } from 'node:timers/promises';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// Models
import type {
    AdminOverview,
    AdminStatusResponse,
    ClaimResponse,
    GcRunStatus,
    NodeResponse,
    TrashPurgeRunStatus,
} from '@fileshed/core';

// Support
import {
    ApiClient,
    type ServerDirs,
    type ServerHandle,
    blobFileExists,
    sha256Of,
    smallFixture,
    spawnServer,
    withDb,
} from './support.ts';

//----------------------------------------------------------------------------------------------------------------------

const SETUP_TOKEN = 'e2e-setup-token-1234';
const ADMIN_EMAIL = 'gc-admin@fileshed.test';
const ADMIN_PASSWORD = 'admin-password-e2e';

// The windows are the experiment. Held open, nothing the first server stages can be collected by its own sweeps,
// whenever they happen to run; closed to zero, everything the second server inherits is collectible on sight.
const WINDOWS_HELD_OPEN = { GC_GRACE_DAYS: '7', TRASH_PURGE_DAYS: '30' };
const WINDOWS_CLOSED = { GC_GRACE_DAYS: '0', TRASH_PURGE_DAYS: '0' };

// The boot passes fire a second after the timers start; poll past that rather than trusting a single sleep.
const SWEEP_POLL_MS = 250;
const SWEEP_POLL_ATTEMPTS = 20;

// Emptied out of the trash before the restart: its node is already gone and its blob already graveyarded.
const doomed = smallFixture('gc-doomed-file');
const doomedSha = sha256Of(doomed);

// Left sitting in the trash across the restart: the purge sweep is what finally takes it.
const lingering = smallFixture('gc-lingering-file');
const lingeringSha = sha256Of(lingering);

// Both sweeps, narrowed to "has reported" at the boundary so the tests read a status that is present by construction.
interface BootSweeps
{
    gc : GcRunStatus;
    trashPurge : TrashPurgeRunStatus;
}

let stagingServer : ServerHandle;
let sweepingServer : ServerHandle;
let dirs : ServerDirs;

let doomedNodeID : string;
let lingeringNodeID : string;

let admin : ApiClient;
let sweeps : BootSweeps;

//----------------------------------------------------------------------------------------------------------------------

// Arrangement fails loudly and immediately: a miswired setup step must never surface as a puzzling assertion failure
// two tests later.
function ensureOk(status : number, step : string) : void
{
    if(status !== 200) { throw new Error(`setup: ${ step } (HTTP ${ status })`); }
}

async function uploadFile(client : ApiClient, name : string, bytes : Buffer) : Promise<NodeResponse>
{
    const claim = await (await client.post('/api/blobs/claim', { sha256: sha256Of(bytes), size: bytes.length }))
        .json() as ClaimResponse;
    if(claim.upload !== true) { throw new Error(`setup: expected an upload ticket for ${ name }`); }

    const params = new URLSearchParams({ name, mimeType: 'application/octet-stream' });
    const put = await client.put(`/api/uploads/${ claim.ticket }?${ params.toString() }`, bytes);
    ensureOk(put.status, `expected ${ name } to upload`);

    return await put.json() as NodeResponse;
}

// Wait for both boot passes to have reported, never for the outcome the tests are about to assert -- a sweep that runs
// and does the wrong thing has to fail an assertion, not quietly time out in a poll that was holding out for success.
async function awaitBootSweeps() : Promise<BootSweeps>
{
    /* eslint-disable no-await-in-loop -- polling is sequential by nature */
    for(let attempt = 0; attempt < SWEEP_POLL_ATTEMPTS; attempt++)
    {
        const res = await admin.get('/api/admin/status');
        ensureOk(res.status, 'expected the admin status readout');

        const body = await res.json() as AdminStatusResponse;
        if(body.gc !== null && body.trashPurge !== null) { return { gc: body.gc, trashPurge: body.trashPurge }; }

        await sleep(SWEEP_POLL_MS);
    }
    /* eslint-enable no-await-in-loop */

    throw new Error('setup: the boot sweeps did not both report in time');
}

// A reading taken after both sweeps are known to have finished. The status response resolves its aggregates before it
// reads the sweep tracker, so the very response that first reports a sweep can carry an overview from a moment before
// it -- only a later request is guaranteed to show the swept instance.
async function currentOverview() : Promise<AdminOverview>
{
    const res = await admin.get('/api/admin/status');
    ensureOk(res.status, 'expected the admin status readout');

    return (await res.json() as AdminStatusResponse).overview;
}

//----------------------------------------------------------------------------------------------------------------------

beforeAll(async () =>
{
    stagingServer = await spawnServer({ env: { FILESHED_SETUP_TOKEN: SETUP_TOKEN, ...WINDOWS_HELD_OPEN } });
    dirs = { dataDir: stagingServer.dataDir, storageRoot: stagingServer.storageRoot };

    const setup = await new ApiClient(stagingServer.baseURL).post('/api/setup', {
        token: SETUP_TOKEN,
        name: 'Admin',
        email: ADMIN_EMAIL,
        password: ADMIN_PASSWORD,
    });
    ensureOk(setup.status, 'expected first-run setup to succeed');

    const stagingAdmin = new ApiClient(stagingServer.baseURL);
    ensureOk((await stagingAdmin.signIn(ADMIN_EMAIL, ADMIN_PASSWORD)).status, 'expected the admin sign-in to succeed');

    // Trashed and then emptied out: the node is purged and the blob it was the only reference to is graveyarded.
    doomedNodeID = (await uploadFile(stagingAdmin, 'doomed.bin', doomed)).id;
    ensureOk((await stagingAdmin.post(`/api/nodes/${ doomedNodeID }/trash`, {})).status, 'expected the file to trash');
    ensureOk((await stagingAdmin.del('/api/trash')).status, 'expected the trash to empty');

    // Trashed and left there: still a live file node, still charging, still referencing its blob.
    lingeringNodeID = (await uploadFile(stagingAdmin, 'lingering.bin', lingering)).id;
    ensureOk(
        (await stagingAdmin.post(`/api/nodes/${ lingeringNodeID }/trash`, {})).status,
        'expected the second file to trash'
    );

    await stagingServer.stop({ keep: true });
});

afterAll(async () =>
{
    // Whichever process last held the shared directories is the one that removes them.
    await (sweepingServer ?? stagingServer)?.stop();
});

//----------------------------------------------------------------------------------------------------------------------
// What the grace windows protect
//----------------------------------------------------------------------------------------------------------------------

describe('state staged under open grace windows', () =>
{
    it('graveyards the emptied file\'s blob while keeping its bytes on disk', async () =>
    {
        const node = await withDb(stagingServer, (db) => db
            .selectFrom('node')
            .select('id')
            .where('id', '=', doomedNodeID)
            .executeTakeFirst());
        expect(node).toBeUndefined();

        const blob = await withDb(stagingServer, (db) => db
            .selectFrom('blob')
            .select([ 'sha256', 'deleted_at' ])
            .where('sha256', '=', doomedSha)
            .executeTakeFirst());
        expect(blob).toBeDefined();
        expect(blob?.deleted_at).not.toBeNull();

        // The graveyard marker is not a delete. The bytes survive the window so a claim can still resurrect them.
        expect(await blobFileExists(stagingServer.storageRoot, doomedSha)).toBe(true);
    });

    it('leaves the trashed file live and its blob unmarked while its retention window is open', async () =>
    {
        const node = await withDb(stagingServer, (db) => db
            .selectFrom('node')
            .select('trashed_at')
            .where('id', '=', lingeringNodeID)
            .executeTakeFirst());
        expect(node).toBeDefined();
        expect(node?.trashed_at).not.toBeNull();

        // A trashed file is still a reference: nothing about its blob has changed.
        const blob = await withDb(stagingServer, (db) => db
            .selectFrom('blob')
            .select('deleted_at')
            .where('sha256', '=', lingeringSha)
            .executeTakeFirst());
        expect(blob?.deleted_at).toBeNull();
        expect(await blobFileExists(stagingServer.storageRoot, lingeringSha)).toBe(true);
    });
});

//----------------------------------------------------------------------------------------------------------------------
// What the boot sweeps reclaim once the windows are shut
//----------------------------------------------------------------------------------------------------------------------

describe('a restart with both windows closed', () =>
{
    beforeAll(async () =>
    {
        sweepingServer = await spawnServer({ dirs, env: WINDOWS_CLOSED });

        admin = new ApiClient(sweepingServer.baseURL);
        ensureOk(
            (await admin.signIn(ADMIN_EMAIL, ADMIN_PASSWORD)).status,
            'expected the account to survive the restart'
        );

        sweeps = await awaitBootSweeps();
    });

    it('collects the expired graveyard blob: the record is gone and so are its bytes', async () =>
    {
        expect(sweeps.gc.summary.candidates).toBeGreaterThanOrEqual(1);
        expect(sweeps.gc.summary.deleted).toBeGreaterThanOrEqual(1);
        expect(sweeps.gc.summary.bytesFailed).toBe(0);

        const blob = await withDb(sweepingServer, (db) => db
            .selectFrom('blob')
            .select('sha256')
            .where('sha256', '=', doomedSha)
            .executeTakeFirst());
        expect(blob).toBeUndefined();

        expect(await blobFileExists(sweepingServer.storageRoot, doomedSha)).toBe(false);
    });

    it('purges the expired trash: the node is deleted and its blob is no longer a live record', async () =>
    {
        expect(sweeps.trashPurge.summary.candidates).toBeGreaterThanOrEqual(1);
        expect(sweeps.trashPurge.summary.purged).toBeGreaterThanOrEqual(1);
        expect(sweeps.trashPurge.summary.failed).toBe(0);

        const node = await withDb(sweepingServer, (db) => db
            .selectFrom('node')
            .select('id')
            .where('id', '=', lingeringNodeID)
            .executeTakeFirst());
        expect(node).toBeUndefined();

        // The purge dropped the file's last reference, so the blob cannot still be live. Whether the GC pass running
        // alongside also carried the record off is down to which sweep queried first, and is not this sweep's promise.
        const live = await withDb(sweepingServer, (db) => db
            .selectFrom('blob')
            .select('sha256')
            .where('sha256', '=', lingeringSha)
            .where('deleted_at', 'is', null)
            .executeTakeFirst());
        expect(live).toBeUndefined();
    });

    it('reports an instance holding nothing once both sweeps have run', async () =>
    {
        const overview = await currentOverview();

        expect(overview.nodes.files).toBe(0);
        expect(overview.trash).toEqual({ count: 0, bytes: 0 });

        // Nothing is charged, because no file node is left to charge; nothing is live on disk, because the one blob
        // that outlived the GC pass is graveyarded rather than live.
        expect(overview.storage.logicalBytes).toBe(0);
        expect(overview.storage.physicalBytes).toBe(0);
    });
});

//----------------------------------------------------------------------------------------------------------------------
