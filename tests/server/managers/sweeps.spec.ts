//----------------------------------------------------------------------------------------------------------------------
// Sweep Manager — running a sweep on demand
//
// The sweeps themselves are the injected boundary here (they are proven against real storage in their own specs), so
// what this drives is the part the manager owns: who may ask, which sweeps exist, and the latch that decides whether
// asking starts anything. Every sweep is held open by a gate the test releases, because "already running" is only
// meaningful while a run is genuinely unfinished.
//----------------------------------------------------------------------------------------------------------------------

import { beforeEach, describe, expect, it } from 'vitest';

// Models
import {
    ConflictError,
    ForbiddenError,
    type GcRunSummary,
    NotFoundError,
    type PartialsRunSummary,
    type TrashPurgeRunSummary,
} from '@fileshed/core';

// Managers
import { LastRunTracker } from '@server/managers/lastRun.ts';
import { SweepManager } from '@server/managers/sweeps.ts';

// Support
import { testActor } from '../nodes/support.ts';

//----------------------------------------------------------------------------------------------------------------------

const ADMIN = testActor({ id: 'admin-actor', role: 'admin' });
const MEMBER = testActor({ id: 'member-actor', role: 'user' });

const GC_RECLAIMED : GcRunSummary = { candidates: 5, deleted: 4, kept: 1, bytesFailed: 0, bytesFreed: 8192 };
const TRASH_PURGED : TrashPurgeRunSummary = { candidates: 3, purged: 3, failed: 0 };
const PARTIALS_REAPED : PartialsRunSummary = { candidates: 2, reclaimed: 2, failed: 0, bytesFreed: 4096 };

//----------------------------------------------------------------------------------------------------------------------

interface Gate<T>
{
    promise : Promise<T>;
    release : (value : T) => void;
    fail : (error : Error) => void;
}

function gate<T>() : Gate<T>
{
    let release : (value : T) => void = () => undefined;
    let fail : (error : Error) => void = () => undefined;

    const promise = new Promise<T>((resolve, reject) =>
    {
        release = resolve;
        fail = reject;
    });

    return { promise, release, fail };
}

// A sweep the test starts and finishes by hand, counting how many times it was actually entered -- the count is the
// only way to see a run that was silently doubled up rather than refused. Every run gets its own gate, so the same
// fake can be held open, released, and held open again; a fake that reused one settled gate would make a manager
// that never releases its latch on success indistinguishable from one that does.
interface FakeSweep<T>
{
    run : () => Promise<T>;
    entered : () => number;

    release : (value : T) => void;
    fail : (error : Error) => void;
}

function fakeSweep<T>() : FakeSweep<T>
{
    let entered = 0;
    let waiting : Gate<T>[] = [];

    function settle(apply : (held : Gate<T>) => void) : void
    {
        const outstanding = waiting;
        waiting = [];

        for(const held of outstanding) { apply(held); }
    }

    return {
        run: () =>
        {
            entered++;

            const held = gate<T>();
            waiting.push(held);

            return held.promise;
        },
        entered: () => entered,
        release: (value) => settle((held) => held.release(value)),
        fail: (error) => settle((held) => held.fail(error)),
    };
}

//----------------------------------------------------------------------------------------------------------------------

let gc : FakeSweep<GcRunSummary>;
let trashPurge : FakeSweep<TrashPurgeRunSummary>;
let partials : FakeSweep<PartialsRunSummary>;
let tracker : LastRunTracker;
let manager : SweepManager;

beforeEach(() =>
{
    gc = fakeSweep<GcRunSummary>();
    trashPurge = fakeSweep<TrashPurgeRunSummary>();
    partials = fakeSweep<PartialsRunSummary>();
    tracker = new LastRunTracker();

    manager = new SweepManager({
        runners: { gc: gc.run, trashPurge: trashPurge.run, partials: partials.run },
        tracker,
    });
});

//----------------------------------------------------------------------------------------------------------------------

describe('SweepManager.run', () =>
{
    it('answers with the counts and bytes the sweep itself reported', async () =>
    {
        const running = manager.run(ADMIN, 'gc');
        gc.release(GC_RECLAIMED);

        await expect(running).resolves.toEqual({
            sweep: 'gc',
            ranAt: expect.any(String),
            summary: GC_RECLAIMED,
        });
    });

    it('records the run it just answered, under the same timestamp it reported', async () =>
    {
        const running = manager.run(ADMIN, 'trashPurge');
        trashPurge.release(TRASH_PURGED);

        const outcome = await running;

        expect(tracker.trashPurge?.summary).toEqual(TRASH_PURGED);
        expect(tracker.trashPurge?.at.toISOString()).toBe(outcome.ranAt);
    });

    it('answers a partials run with what the reaper reclaimed, and records that run', async () =>
    {
        const running = manager.run(ADMIN, 'partials');
        partials.release(PARTIALS_REAPED);

        const outcome = await running;

        expect(outcome).toEqual({ sweep: 'partials', ranAt: expect.any(String), summary: PARTIALS_REAPED });
        expect(tracker.partials?.summary).toEqual(PARTIALS_REAPED);
        expect(tracker.partials?.at.toISOString()).toBe(outcome.ranAt);
    });

    it('refuses a second run while the first is still going, without starting the sweep again', async () =>
    {
        const running = manager.run(ADMIN, 'gc');

        await expect(manager.run(ADMIN, 'gc')).rejects.toThrow(ConflictError);
        expect(gc.entered()).toBe(1);

        gc.release(GC_RECLAIMED);
        await running;
    });

    it('refuses a run while the scheduled sweep is the one in flight', async () =>
    {
        const scheduled = manager.runScheduled('gc');

        await expect(manager.run(ADMIN, 'gc')).rejects.toThrow(/already running/i);
        expect(gc.entered()).toBe(1);

        gc.release(GC_RECLAIMED);
        await scheduled;
    });

    // Against the same manager on purpose: a latch that only ever clears on failure would satisfy a second manager
    // just as happily, and the sweep would then be unrunnable for the life of the process after its first success.
    it('lets the sweep be run again once the one in flight has finished', async () =>
    {
        const running = manager.run(ADMIN, 'gc');
        gc.release(GC_RECLAIMED);
        await running;

        const again = manager.run(ADMIN, 'gc');
        gc.release(GC_RECLAIMED);

        await expect(again).resolves.toMatchObject({ sweep: 'gc' });
        expect(gc.entered()).toBe(2);
    });

    it('releases the latch when a sweep fails, so a failed run does not wedge the button', async () =>
    {
        const failing = manager.run(ADMIN, 'gc');
        gc.fail(new Error('the backend went away'));

        await expect(failing).rejects.toThrow('the backend went away');

        // The refusal would be a ConflictError; a fresh attempt gets as far as entering the sweep instead.
        void manager.run(ADMIN, 'gc').catch(() => undefined);
        expect(gc.entered()).toBe(2);
    });

    it('holds each sweep\'s latch separately, so one running does not refuse the others', async () =>
    {
        const collecting = manager.run(ADMIN, 'gc');
        const purging = manager.run(ADMIN, 'trashPurge');
        const reaping = manager.run(ADMIN, 'partials');

        gc.release(GC_RECLAIMED);
        trashPurge.release(TRASH_PURGED);
        partials.release(PARTIALS_REAPED);

        await expect(collecting).resolves.toMatchObject({ sweep: 'gc' });
        await expect(purging).resolves.toMatchObject({ sweep: 'trashPurge' });
        await expect(reaping).resolves.toMatchObject({ sweep: 'partials' });
    });

    it('refuses a caller who is not an admin, and runs nothing', async () =>
    {
        await expect(manager.run(MEMBER, 'gc')).rejects.toThrow(ForbiddenError);
        expect(gc.entered()).toBe(0);
    });

    it('refuses a sweep name it does not have, and runs nothing', async () =>
    {
        await expect(manager.run(ADMIN, 'defragment')).rejects.toThrow(NotFoundError);
        expect(gc.entered()).toBe(0);
        expect(trashPurge.entered()).toBe(0);
        expect(partials.entered()).toBe(0);
    });

    it('judges authority before the sweep name, so a stranger learns nothing about which sweeps exist', async () =>
    {
        await expect(manager.run(MEMBER, 'defragment')).rejects.toThrow(ForbiddenError);
    });
});

//----------------------------------------------------------------------------------------------------------------------

describe('SweepManager.runScheduled', () =>
{
    it('runs the sweep and records what it reclaimed, exactly as an admin run does', async () =>
    {
        const scheduled = manager.runScheduled('gc');
        gc.release(GC_RECLAIMED);

        await scheduled;

        expect(gc.entered()).toBe(1);
        expect(tracker.gc?.summary).toEqual(GC_RECLAIMED);
    });

    it('skips a tick while an admin run is still going, rather than doubling up', async () =>
    {
        const running = manager.run(ADMIN, 'gc');

        await manager.runScheduled('gc');

        expect(gc.entered()).toBe(1);

        gc.release(GC_RECLAIMED);
        await running;
    });

    // A pass that overruns its own interval must not stack on the next one: the sweeps read the whole store, and two
    // of them at once is the case the latch exists for.
    it('skips a tick while its own previous run is still going', async () =>
    {
        const scheduled = manager.runScheduled('gc');

        await manager.runScheduled('gc');

        expect(gc.entered()).toBe(1);

        gc.release(GC_RECLAIMED);
        await scheduled;
    });

    it('sweeps again on the next tick once the previous one has finished', async () =>
    {
        const scheduled = manager.runScheduled('gc');
        gc.release(GC_RECLAIMED);
        await scheduled;

        const again = manager.runScheduled('gc');
        gc.release(GC_RECLAIMED);
        await again;

        expect(gc.entered()).toBe(2);
    });

    // The failure is the timer's to log; swallowing it here would leave a sweep failing every hour in silence.
    it('raises a failed sweep to whoever asked for the tick, and clears the latch behind it', async () =>
    {
        const failing = manager.runScheduled('gc');
        gc.fail(new Error('the backend went away'));

        await expect(failing).rejects.toThrow('the backend went away');

        void manager.runScheduled('gc').catch(() => undefined);

        expect(gc.entered()).toBe(2);
    });
});

//----------------------------------------------------------------------------------------------------------------------
