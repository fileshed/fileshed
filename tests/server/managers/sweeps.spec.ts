//----------------------------------------------------------------------------------------------------------------------
// Sweep Manager — running a sweep on demand
//
// The sweeps themselves are the injected boundary here (they are proven against real storage in their own specs), so
// what this drives is the part the manager owns: who may ask, which sweeps exist, and the latch that decides whether
// asking starts anything. Every sweep is held open by a gate the test releases, because "already running" is only
// meaningful while a run is genuinely unfinished.
//----------------------------------------------------------------------------------------------------------------------

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Models
import {
    ConflictError,
    ForbiddenError,
    type GcRunSummary,
    MS_PER_SECOND,
    NotFoundError,
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

const INTERVAL_MS = 60 * MS_PER_SECOND;

const GC_RECLAIMED : GcRunSummary = { candidates: 5, deleted: 4, kept: 1, bytesFailed: 0, bytesFreed: 8192 };
const TRASH_PURGED : TrashPurgeRunSummary = { candidates: 3, purged: 3, failed: 0 };

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
let tracker : LastRunTracker;
let manager : SweepManager;
let stopTimers : (() => void) | null;

beforeEach(() =>
{
    gc = fakeSweep<GcRunSummary>();
    trashPurge = fakeSweep<TrashPurgeRunSummary>();
    tracker = new LastRunTracker();
    stopTimers = null;

    manager = new SweepManager({ runners: { gc: gc.run, trashPurge: trashPurge.run }, tracker });
});

afterEach(() =>
{
    stopTimers?.();
    vi.useRealTimers();
});

// Start the schedule and let the boot pass fire, which claims the latch for both sweeps exactly as a timer would.
function startScheduledSweeps() : void
{
    vi.useFakeTimers();
    stopTimers = manager.startTimers(INTERVAL_MS);
    vi.advanceTimersByTime(MS_PER_SECOND);
}

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
        startScheduledSweeps();

        await expect(manager.run(ADMIN, 'gc')).rejects.toThrow(/already running/i);
        expect(gc.entered()).toBe(1);

        gc.release(GC_RECLAIMED);
        trashPurge.release(TRASH_PURGED);
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

    it('holds each sweep\'s latch separately, so one running does not refuse the other', async () =>
    {
        const collecting = manager.run(ADMIN, 'gc');
        const purging = manager.run(ADMIN, 'trashPurge');

        gc.release(GC_RECLAIMED);
        trashPurge.release(TRASH_PURGED);

        await expect(collecting).resolves.toMatchObject({ sweep: 'gc' });
        await expect(purging).resolves.toMatchObject({ sweep: 'trashPurge' });
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
    });

    it('judges authority before the sweep name, so a stranger learns nothing about which sweeps exist', async () =>
    {
        await expect(manager.run(MEMBER, 'defragment')).rejects.toThrow(ForbiddenError);
    });
});

//----------------------------------------------------------------------------------------------------------------------

describe('SweepManager.startTimers', () =>
{
    it('skips a scheduled tick while an admin run is still going, rather than doubling up', async () =>
    {
        const running = manager.run(ADMIN, 'gc');

        startScheduledSweeps();

        expect(gc.entered()).toBe(1);

        gc.release(GC_RECLAIMED);
        trashPurge.release(TRASH_PURGED);
        await running;
    });

    it('sweeps shortly after boot rather than waiting out the first interval', () =>
    {
        startScheduledSweeps();

        expect(gc.entered()).toBe(1);
        expect(trashPurge.entered()).toBe(1);
    });

    it('goes on sweeping every interval, not only the once at boot', async () =>
    {
        startScheduledSweeps();

        gc.release(GC_RECLAIMED);
        trashPurge.release(TRASH_PURGED);

        await vi.advanceTimersByTimeAsync(INTERVAL_MS);

        expect(gc.entered()).toBe(2);
        expect(trashPurge.entered()).toBe(2);
    });

    // A sweep that throws takes its rejection no further than the tick that started it. If it did, the failure would
    // reach the process as an unhandled rejection and the interval behind it would stop for good on the first bad run.
    it('keeps sweeping after a scheduled run fails', async () =>
    {
        startScheduledSweeps();

        gc.fail(new Error('the backend went away'));
        trashPurge.release(TRASH_PURGED);

        await vi.advanceTimersByTimeAsync(INTERVAL_MS);

        expect(gc.entered()).toBe(2);
    });

    it('stops sweeping once the handle is called', () =>
    {
        vi.useFakeTimers();
        const stop = manager.startTimers(INTERVAL_MS);
        stop();

        vi.advanceTimersByTime(INTERVAL_MS * 3);

        expect(gc.entered()).toBe(0);
        expect(trashPurge.entered()).toBe(0);
    });
});

//----------------------------------------------------------------------------------------------------------------------
