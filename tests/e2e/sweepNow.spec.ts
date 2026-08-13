//----------------------------------------------------------------------------------------------------------------------
// E2E — Lower a retention, then reclaim the space without waiting for the timer
//
// The whole point of running a sweep on demand, against a real process: the server boots with both windows held wide
// open, so its own boot passes collect nothing and everything staged here survives them. An admin then lowers a window
// through the settings endpoint and runs the sweep, and the bytes go -- inside one test, not one sweep interval later.
//
// The interval is set far past the run so no scheduled pass can be the thing that did the reclaiming. What the sweep
// reports is checked against the disk and the database, because a summary nobody corroborates is just a number.
//----------------------------------------------------------------------------------------------------------------------

import { setTimeout as delay } from 'node:timers/promises';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// Models
import type {
    AdminStatusResponse,
    ClaimResponse,
    GcSweepRunResponse,
    NodeResponse,
    TrashPurgeSweepRunResponse,
} from '@fileshed/core';

// Support
import {
    ApiClient,
    type ServerHandle,
    blobFileExists,
    sha256Of,
    smallFixture,
    spawnServer,
    withDb,
} from './support.ts';

//----------------------------------------------------------------------------------------------------------------------

const SETUP_TOKEN = 'e2e-sweep-now-token';
const ADMIN_EMAIL = 'sweep-now-admin@fileshed.test';
const ADMIN_PASSWORD = 'admin-password-e2e';

// Held open so nothing this spec stages can be taken by a scheduled pass, and scheduled an hour out so the only sweep
// that runs inside the spec is the one an admin asks for.
const HELD_OPEN = { GC_GRACE_DAYS: '7', TRASH_PURGE_DAYS: '30', GC_INTERVAL_MINUTES: '60' };

// The boot pass fires a second after the server starts, so setup is usually past it already; this is the backstop
// for the run where it is not.
const BOOT_PASS_TIMEOUT_MS = 10_000;
const BOOT_PASS_POLL_MS = 50;

const collectible = smallFixture('sweep-now-collectible');
const collectibleSha = sha256Of(collectible);

const lingering = smallFixture('sweep-now-lingering');

let server : ServerHandle;
let admin : ApiClient;
let lingeringNodeID : string;

//----------------------------------------------------------------------------------------------------------------------

function ensureOk(status : number, step : string) : void
{
    if(status !== 200) { throw new Error(`setup: ${ step } (HTTP ${ status })`); }
}

async function uploadFile(name : string, bytes : Buffer) : Promise<NodeResponse>
{
    const claim = await (await admin.post('/api/blobs/claim', { sha256: sha256Of(bytes), size: bytes.length }))
        .json() as ClaimResponse;
    if(claim.upload !== true) { throw new Error(`setup: expected an upload ticket for ${ name }`); }

    const params = new URLSearchParams({ name, mimeType: 'application/octet-stream' });
    const put = await admin.put(`/api/uploads/${ claim.ticket }?${ params.toString() }`, bytes);
    ensureOk(put.status, `expected ${ name } to upload`);

    return await put.json() as NodeResponse;
}

// The server sweeps once shortly after boot, and a run that lands inside that pass is refused -- so every test here
// would be racing however long setup happened to take. The readout naming both sweeps is that pass having finished,
// which is a signal rather than a guess.
async function waitOutTheBootPass(deadline = Date.now() + BOOT_PASS_TIMEOUT_MS) : Promise<void>
{
    const body = await (await admin.get('/api/admin/status')).json() as AdminStatusResponse;
    if(body.gc !== null && body.trashPurge !== null) { return; }

    if(Date.now() >= deadline) { throw new Error('setup: the server never finished its boot sweeps'); }

    await delay(BOOT_PASS_POLL_MS);

    return waitOutTheBootPass(deadline);
}

async function blobRowExists(sha256 : string) : Promise<boolean>
{
    const row = await withDb(server, (db) => db
        .selectFrom('blob')
        .select('sha256')
        .where('sha256', '=', sha256)
        .executeTakeFirst());

    return row !== undefined;
}

//----------------------------------------------------------------------------------------------------------------------

beforeAll(async () =>
{
    server = await spawnServer({ env: { FILESHED_SETUP_TOKEN: SETUP_TOKEN, ...HELD_OPEN } });

    const setup = await new ApiClient(server.baseURL).post('/api/setup', {
        token: SETUP_TOKEN,
        name: 'Admin',
        email: ADMIN_EMAIL,
        password: ADMIN_PASSWORD,
    });
    ensureOk(setup.status, 'expected first-run setup to succeed');

    admin = new ApiClient(server.baseURL);
    ensureOk((await admin.signIn(ADMIN_EMAIL, ADMIN_PASSWORD)).status, 'expected the admin sign-in to succeed');

    // Trashed and emptied out: the node is gone and its blob graveyarded, but the open grace window means the bytes
    // are still on disk and no sweep of this server's own will take them.
    const doomed = await uploadFile('collectible.bin', collectible);
    ensureOk((await admin.post(`/api/nodes/${ doomed.id }/trash`, {})).status, 'expected the file to trash');
    ensureOk((await admin.del('/api/trash')).status, 'expected the trash to empty');

    // Trashed and left there, for the purge to take.
    lingeringNodeID = (await uploadFile('lingering.bin', lingering)).id;
    ensureOk(
        (await admin.post(`/api/nodes/${ lingeringNodeID }/trash`, {})).status,
        'expected the second file to trash'
    );

    await waitOutTheBootPass();
});

afterAll(async () =>
{
    await server?.stop();
});

//----------------------------------------------------------------------------------------------------------------------

describe('running a sweep from the admin surface', () =>
{
    it('leaves the graveyarded bytes alone while the grace window is open', async () =>
    {
        expect(await blobRowExists(collectibleSha)).toBe(true);
        expect(await blobFileExists(server.storageRoot, collectibleSha)).toBe(true);

        // Nothing is collectible yet, and the sweep says so rather than refusing to run.
        const res = await admin.post('/api/admin/sweeps/gc/run');
        expect(res.status).toBe(200);

        const body = await res.json() as GcSweepRunResponse;
        expect(body.summary).toEqual({ candidates: 0, deleted: 0, kept: 0, bytesFailed: 0, bytesFreed: 0 });
        expect(await blobFileExists(server.storageRoot, collectibleSha)).toBe(true);
    });

    it('collects the bytes as soon as the window is lowered, without waiting for the interval', async () =>
    {
        const patched = await admin.patch('/api/admin/settings', { changes: { GC_GRACE_DAYS: 0 } });
        ensureOk(patched.status, 'expected the grace window to be lowered');

        const res = await admin.post('/api/admin/sweeps/gc/run');
        expect(res.status).toBe(200);

        // What it says it reclaimed is the file's own size, and the disk agrees.
        const body = await res.json() as GcSweepRunResponse;
        expect(body.sweep).toBe('gc');
        expect(body.summary).toMatchObject({ candidates: 1, deleted: 1, bytesFreed: collectible.length });

        expect(await blobRowExists(collectibleSha)).toBe(false);
        expect(await blobFileExists(server.storageRoot, collectibleSha)).toBe(false);
    });

    it('reports the run it just answered on the status readout', async () =>
    {
        const status = await admin.get('/api/admin/status');
        ensureOk(status.status, 'expected the admin status readout');

        const body = await status.json() as AdminStatusResponse;

        expect(body.gc?.summary).toMatchObject({ deleted: 1, bytesFreed: collectible.length });
        expect(body.overview.storage.graveyardCount).toBe(0);
    });

    it('purges the trash on demand once its retention is lowered', async () =>
    {
        const patched = await admin.patch('/api/admin/settings', { changes: { TRASH_PURGE_DAYS: 0 } });
        ensureOk(patched.status, 'expected the retention to be lowered');

        const res = await admin.post('/api/admin/sweeps/trashPurge/run');
        expect(res.status).toBe(200);

        const body = await res.json() as TrashPurgeSweepRunResponse;
        expect(body.sweep).toBe('trashPurge');
        expect(body.summary).toEqual({ candidates: 1, purged: 1, failed: 0 });

        const node = await withDb(server, (db) => db
            .selectFrom('node')
            .select('id')
            .where('id', '=', lingeringNodeID)
            .executeTakeFirst());
        expect(node).toBeUndefined();
    });

    it('refuses a caller who is not an admin', async () =>
    {
        const member = new ApiClient(server.baseURL);
        const signedUp = await member.signUp('sweep-now-member@fileshed.test', 'member-password-e2e');
        ensureOk(signedUp.status, 'expected the member sign-up to succeed');

        expect((await member.post('/api/admin/sweeps/gc/run')).status).toBe(403);
    });

    it('answers 404 for a sweep the instance does not have', async () =>
    {
        expect((await admin.post('/api/admin/sweeps/defragment/run')).status).toBe(404);
    });
});

//----------------------------------------------------------------------------------------------------------------------
