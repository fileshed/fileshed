//----------------------------------------------------------------------------------------------------------------------
// Admin Route — POST /api/admin/sweeps/:sweep/run
//
// Running a sweep on demand, over real HTTP against a real blob store: the response has to be what the sweep actually
// reclaimed, so every success here is checked twice -- once against the summary the endpoint answered, and once
// against the store and the database, which must agree that the bytes and rows are gone. The authn (401) / authz
// (403) / unknown-sweep (404) ladder rides the same route, and a sweep already running answers 409 rather than
// starting a second one.
//----------------------------------------------------------------------------------------------------------------------

/* eslint-disable camelcase -- seed helpers build snake_case DB rows (house convention for Kysely inserts) */

import { createHash, randomBytes } from 'node:crypto';
import { Readable } from 'node:stream';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

// Models
import {
    type AdminStatusResponse,
    type GcSweepRunResponse,
    MS_PER_DAY,
    type SweepRunResponse,
    type TrashPurgeSweepRunResponse,
    sweepRunResponseCodec,
} from '@fileshed/core';

// Resource Access
import { BlobNotFoundError } from '@server/resource-access/blob/index.ts';
import { NodeRA } from '@server/resource-access/nodes/node.ts';
import { ShareRA } from '@server/resource-access/shares/index.ts';
import { UserRA } from '@server/resource-access/users/index.ts';

// Managers
import { LastRunTracker } from '@server/managers/lastRun.ts';
import { NodeManager } from '@server/managers/node.ts';
import { SessionManager } from '@server/managers/session.ts';
import { StatusManager } from '@server/managers/status.ts';
import { SweepManager, type SweepRunners } from '@server/managers/sweeps.ts';
import { runGcOnce } from '@server/managers/gc.ts';
import { runTrashPurgeOnce } from '@server/managers/trashPurge.ts';

// Routes
import { createAdminRuntimeRoutes } from '@server/routes/admin.ts';

// Support
import { type BootedBlobApp, ORIGIN, bootBlobApp, cookieFrom, signIn, signUp } from '../blobs/support.ts';
import { fileNode, folderNode } from '../resource-access/nodes/support.ts';
import { testNodePolicy } from '../nodes/support.ts';

//----------------------------------------------------------------------------------------------------------------------

const PASSWORD = 'correct-horse-battery';
const GRACE_MS = 7 * MS_PER_DAY;

// Comfortably outside any window the specs open: graveyarded or trashed at this instant is collectible on sight.
const LAPSED = new Date('2020-01-01T00:00:00.000Z');

let booted : BootedBlobApp;
let nodeRA : NodeRA;
let tracker : LastRunTracker;

//----------------------------------------------------------------------------------------------------------------------

// Mount the admin surface over whichever runners a spec wants. The default pair are the real sweeps against this
// app's real store; the concurrency spec substitutes one it can hold open.
function mountAdmin(runners ?: Partial<SweepRunners>) : void
{
    const sessions = new SessionManager(booted.auth);
    const nodes = new NodeManager(booted.handle, nodeRA, booted.blob, testNodePolicy());

    const status = new StatusManager({
        blob: booted.blob,
        nodes: nodeRA,
        users: new UserRA(booted.handle),
        shares: new ShareRA(booted.handle),
        tracker,
        version: '0.0.0-sweep-spec',
        databaseKind: booted.handle.kind,
        startedAt: new Date(),
        activeProviders: 0,
        emailEnabled: async () => false,
        signUpEnabled: async () => true,
    });

    const sweeps = new SweepManager({
        runners: {
            gc: () => runGcOnce({ blob: booted.blob, graceMs: async () => GRACE_MS }),
            trashPurge: () => runTrashPurgeOnce({ nodes: nodeRA, purger: nodes, graceMs: async () => GRACE_MS }),
            ...runners,
        },
        tracker,
    });

    booted.app.route('/api', createAdminRuntimeRoutes(sessions, status, sweeps));
}

beforeEach(async () =>
{
    booted = await bootBlobApp();
    nodeRA = new NodeRA(booted.handle);
    tracker = new LastRunTracker();
});

afterEach(async () =>
{
    await booted.cleanup();
});

//----------------------------------------------------------------------------------------------------------------------

async function makeAdmin(email : string) : Promise<string>
{
    await signUp(booted.app, email, PASSWORD);
    await booted.handle.db.updateTable('user').set({ role: 'admin' })
        .where('email', '=', email)
        .execute();

    return cookieFrom(await signIn(booted.app, email, PASSWORD));
}

async function makeMember(email : string) : Promise<string>
{
    return cookieFrom(await signUp(booted.app, email, PASSWORD));
}

async function runSweep(sweep : string, cookie ?: string) : Promise<Response>
{
    const headers : Record<string, string> = { origin: ORIGIN };
    if(cookie !== undefined) { headers['cookie'] = cookie; }

    return booted.app.request(`${ ORIGIN }/api/admin/sweeps/${ sweep }/run`, { method: 'POST', headers });
}

//----------------------------------------------------------------------------------------------------------------------

// Real bytes through the storage RA plus the record row that points at them, graveyarded at a chosen moment.
async function seedGraveyardedBlob(size : number, deletedAt : Date | null) : Promise<string>
{
    const bytes = randomBytes(size);
    const sha256 = createHash('sha256')
        .update(bytes)
        .digest('hex');

    const location = await booted.blob.put(sha256, Readable.from(bytes), bytes.length);

    await booted.handle.db
        .insertInto('blob')
        .values({
            sha256,
            size: bytes.length,
            backend_id: location.backendID,
            storage_key: location.storageKey,
            created_at: new Date().toISOString(),
            deleted_at: deletedAt === null ? null : deletedAt.toISOString(),
        })
        .execute();

    return sha256;
}

async function blobRowExists(sha256 : string) : Promise<boolean>
{
    const row = await booted.handle.db.selectFrom('blob').select('sha256')
        .where('sha256', '=', sha256)
        .executeTakeFirst();

    return row !== undefined;
}

async function blobBytesExist(sha256 : string) : Promise<boolean>
{
    try
    {
        await booted.blob.getStream({ backendID: booted.backendID, storageKey: sha256 });
        return true;
    }
    catch(error)
    {
        if(error instanceof BlobNotFoundError) { return false; }
        throw error;
    }
}

//----------------------------------------------------------------------------------------------------------------------

describe('POST /api/admin/sweeps/:sweep/run', () =>
{
    it('collects the graveyarded bytes and answers with what it actually reclaimed', async () =>
    {
        mountAdmin();
        const cookie = await makeAdmin('gc-runner@t.test');

        const collectible = await seedGraveyardedBlob(4096, LAPSED);
        const protectedByGrace = await seedGraveyardedBlob(2048, new Date());
        const live = await seedGraveyardedBlob(1024, null);

        const res = await runSweep('gc', cookie);
        expect(res.status).toBe(200);

        // One candidate, one collected, and the freed figure is that blob's own size -- not the graveyard total,
        // which still holds the one inside its window.
        const body = sweepRunResponseCodec.parse(await res.json()) as GcSweepRunResponse;
        expect(body.sweep).toBe('gc');
        expect(body.summary).toEqual({ candidates: 1, deleted: 1, kept: 0, bytesFailed: 0, bytesFreed: 4096 });

        // The summary is only worth as much as the store agrees with: the collected blob is gone from both, and
        // neither of the two it had no business touching moved.
        expect(await blobRowExists(collectible)).toBe(false);
        expect(await blobBytesExist(collectible)).toBe(false);

        expect(await blobRowExists(protectedByGrace)).toBe(true);
        expect(await blobBytesExist(protectedByGrace)).toBe(true);
        expect(await blobRowExists(live)).toBe(true);
        expect(await blobBytesExist(live)).toBe(true);
    });

    it('reports nothing reclaimed when there is nothing to collect, rather than a bare acknowledgement', async () =>
    {
        mountAdmin();
        const cookie = await makeAdmin('gc-idle@t.test');

        const body = sweepRunResponseCodec.parse(await (await runSweep('gc', cookie)).json()) as GcSweepRunResponse;

        expect(body.summary).toEqual({ candidates: 0, deleted: 0, kept: 0, bytesFailed: 0, bytesFreed: 0 });
    });

    it('purges the expired trash and answers with the subtrees it took', async () =>
    {
        mountAdmin();
        const cookie = await makeAdmin('purge-runner@t.test');
        const owner = await booted.handle.db.selectFrom('user').select('id')
            .where('email', '=', 'purge-runner@t.test')
            .executeTakeFirstOrThrow();

        const sha = await seedGraveyardedBlob(512, null);
        await nodeRA.insert(folderNode({ id: 'keep', ownerID: owner.id }));
        await nodeRA.insert(folderNode({ id: 'doomed', ownerID: owner.id, trashedAt: LAPSED }));
        await nodeRA.insert(fileNode({
            id: 'doomed-file',
            ownerID: owner.id,
            parentID: 'doomed',
            blobID: sha,
            trashedAt: LAPSED,
        }));

        const res = await runSweep('trashPurge', cookie);
        expect(res.status).toBe(200);

        const body = sweepRunResponseCodec.parse(await res.json()) as TrashPurgeSweepRunResponse;
        expect(body.sweep).toBe('trashPurge');
        expect(body.summary).toEqual({ candidates: 1, purged: 1, failed: 0 });

        expect(await nodeRA.get('doomed')).toBeUndefined();
        expect(await nodeRA.get('doomed-file')).toBeUndefined();
        expect(await nodeRA.get('keep')).toBeDefined();
    });

    it('records the run it answered, so the status readout agrees with what the admin was told', async () =>
    {
        mountAdmin();
        const cookie = await makeAdmin('gc-recorder@t.test');
        await seedGraveyardedBlob(4096, LAPSED);

        const run = sweepRunResponseCodec.parse(await (await runSweep('gc', cookie)).json()) as SweepRunResponse;

        const status = await booted.app.request(`${ ORIGIN }/api/admin/status`, { headers: { cookie } });
        const body = await status.json() as AdminStatusResponse;

        expect(body.gc).toEqual({ ranAt: run.ranAt, summary: run.summary });
    });

    it('refuses a sweep already running instead of starting a second one', async () =>
    {
        // The sweep is held open for as long as the spec wants, which is the only way to be inside a run while
        // another request arrives -- in production the run being collided with is usually the scheduled one.
        let release : () => void = () => undefined;
        const held = new Promise<void>((resolve) => { release = resolve; });

        // Dispatch order is not arrival order. Both requests resolve their admin session first, and on Postgres that
        // is a real round trip on a contended pool -- either can win, and the loser is the one refused. So the second
        // request waits for a signal the sweep itself raises, which only happens once the latch is provably held.
        let signalEntered : () => void = () => undefined;
        const entering = new Promise<void>((resolve) => { signalEntered = resolve; });

        let entered = 0;
        mountAdmin({
            gc: async () =>
            {
                entered++;
                signalEntered();
                await held;

                return { candidates: 0, deleted: 0, kept: 0, bytesFailed: 0, bytesFreed: 0 };
            },
        });

        const cookie = await makeAdmin('gc-collider@t.test');

        const first = runSweep('gc', cookie);
        await entering;
        const second = await runSweep('gc', cookie);

        expect(second.status).toBe(409);
        expect(await second.json()).toMatchObject({ code: 'sweep.alreadyRunning' });
        expect(entered).toBe(1);

        release();
        expect((await first).status).toBe(200);
    });

    it('refuses a caller with no session', async () =>
    {
        mountAdmin();

        expect((await runSweep('gc')).status).toBe(401);
    });

    it('refuses a signed-in caller who is not an admin', async () =>
    {
        mountAdmin();
        const cookie = await makeMember('member@t.test');

        expect((await runSweep('gc', cookie)).status).toBe(403);
    });

    it('does not run anything for a non-admin, whatever the graveyard holds', async () =>
    {
        mountAdmin();
        const cookie = await makeMember('member2@t.test');
        const collectible = await seedGraveyardedBlob(4096, LAPSED);

        await runSweep('gc', cookie);

        expect(await blobRowExists(collectible)).toBe(true);
        expect(await blobBytesExist(collectible)).toBe(true);
    });

    it('answers 404 for a sweep it does not have', async () =>
    {
        mountAdmin();
        const cookie = await makeAdmin('gc-typo@t.test');

        expect((await runSweep('defragment', cookie)).status).toBe(404);
    });

    it('answers a non-admin 403 for an unknown sweep, telling them nothing about which sweeps exist', async () =>
    {
        mountAdmin();
        const cookie = await makeMember('member3@t.test');

        expect((await runSweep('defragment', cookie)).status).toBe(403);
    });
});

//----------------------------------------------------------------------------------------------------------------------
