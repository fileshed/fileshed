//----------------------------------------------------------------------------------------------------------------------
// Timer Manager
//
// What a job does is never this manager's business, so every job here is a counter: entries are the only way to see a
// run that was doubled up, skipped, or lost with the interval that was supposed to carry it.
//----------------------------------------------------------------------------------------------------------------------

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Models
import { MS_PER_SECOND } from '@fileshed/core';

// Managers
import { type TimerJob, TimerManager } from '@server/managers/timers.ts';

//----------------------------------------------------------------------------------------------------------------------

const INTERVAL_MS = 60 * MS_PER_SECOND;

// Comfortably inside INTERVAL_MS, so a job on this one comes round while the others are still waiting.
const BRISK_INTERVAL_MS = 5 * MS_PER_SECOND;

//----------------------------------------------------------------------------------------------------------------------

interface CountedJob
{
    job : TimerJob;
    entered : () => number;
}

interface JobOptions
{
    intervalMs ?: number;

    // What one run does. The interesting answers are the ones a manager can mishandle: a rejection, a synchronous
    // throw, and a promise that never settles.
    answer ?: () => unknown;
}

function countingJob(name : string, immediate : boolean, options : JobOptions = {}) : CountedJob
{
    const answer = options.answer ?? (() => undefined);
    let entered = 0;

    return {
        job: {
            name,
            intervalMs: options.intervalMs ?? INTERVAL_MS,
            immediate,
            run: () =>
            {
                entered++;
                return answer();
            },
        },
        entered: () => entered,
    };
}

function hangs() : Promise<never>
{
    return new Promise<never>(() => undefined);
}

function fails() : Promise<never>
{
    return Promise.reject(new Error('the backend went away'));
}

function throws() : never
{
    throw new Error('the backend went away');
}

//----------------------------------------------------------------------------------------------------------------------

let manager : TimerManager;

beforeEach(() =>
{
    vi.useFakeTimers();
    manager = new TimerManager();
});

afterEach(() =>
{
    manager.stopTimers();
    vi.useRealTimers();
});

//----------------------------------------------------------------------------------------------------------------------

describe('TimerManager.startTimers', () =>
{
    it('runs an immediate job on the start call rather than an interval later', () =>
    {
        const sweep = countingJob('sweep', true);
        manager.register(sweep.job);

        manager.startTimers();

        expect(sweep.entered()).toBe(1);
    });

    it('holds a job that is not immediate back until its first interval comes round', async () =>
    {
        const prune = countingJob('prune', false);
        manager.register(prune.job);

        manager.startTimers();

        expect(prune.entered()).toBe(0);

        await vi.advanceTimersByTimeAsync(INTERVAL_MS);

        expect(prune.entered()).toBe(1);
    });

    it('goes on running a job every interval, not only the once', async () =>
    {
        const prune = countingJob('prune', false);
        manager.register(prune.job);

        manager.startTimers();

        await vi.advanceTimersByTimeAsync(INTERVAL_MS * 3);

        expect(prune.entered()).toBe(3);
    });

    // Abandoned upload staging is reclaimed far more often than the sweeps that read the database, so a job must come
    // round on its own cadence rather than the slowest one in the registry.
    it('runs each job on its own interval rather than the slowest in the registry', async () =>
    {
        const slow = countingJob('slow', false);
        const brisk = countingJob('brisk', false, { intervalMs: BRISK_INTERVAL_MS });
        manager.register(slow.job);
        manager.register(brisk.job);

        manager.startTimers();

        await vi.advanceTimersByTimeAsync(BRISK_INTERVAL_MS);

        expect(brisk.entered()).toBe(1);
        expect(slow.entered()).toBe(0);
    });

    // Boot registers every job and starts them in one call, so an immediate run that is waited on rather than
    // scheduled would hold the whole server behind a sweep of someone's library.
    it('schedules an immediate run rather than waiting on it', async () =>
    {
        const stuck = countingJob('stuck', true, { answer: hangs });
        const brisk = countingJob('brisk', true);
        manager.register(stuck.job);
        manager.register(brisk.job);

        manager.startTimers();

        expect(brisk.entered()).toBe(1);

        await vi.advanceTimersByTimeAsync(INTERVAL_MS);

        expect(brisk.entered()).toBe(2);
    });

    it('schedules nothing a second time when the timers are started again', async () =>
    {
        const prune = countingJob('prune', false);
        manager.register(prune.job);

        manager.startTimers();
        manager.startTimers();

        await vi.advanceTimersByTimeAsync(INTERVAL_MS);

        expect(prune.entered()).toBe(1);
    });

    it('does not run an immediate job again when the timers are started again', () =>
    {
        const sweep = countingJob('sweep', true);
        manager.register(sweep.job);

        manager.startTimers();
        manager.startTimers();

        expect(sweep.entered()).toBe(1);
    });

    // Start means start, every time: a job stopped for a spec and started again is entitled to the boot pass it was
    // registered with, not a silently different first tick.
    it('runs immediate jobs again after a stop and a fresh start', () =>
    {
        const sweep = countingJob('sweep', true);
        manager.register(sweep.job);

        manager.startTimers();
        manager.stopTimers();
        manager.startTimers();

        expect(sweep.entered()).toBe(2);
    });

    // An escaping rejection reaches the process unhandled, and the interval behind it is dead from the first bad run.
    it('keeps a job on its interval after a run rejects', async () =>
    {
        const flaky = countingJob('flaky', false, { answer: fails });
        manager.register(flaky.job);

        manager.startTimers();

        await vi.advanceTimersByTimeAsync(INTERVAL_MS * 2);

        expect(flaky.entered()).toBe(2);
    });

    it('keeps a job on its interval after a run throws before it returns anything at all', async () =>
    {
        const flaky = countingJob('flaky', false, { answer: throws });
        manager.register(flaky.job);

        manager.startTimers();

        await vi.advanceTimersByTimeAsync(INTERVAL_MS * 2);

        expect(flaky.entered()).toBe(2);
    });

    // The start call is the last thing boot does. A job that throws on its immediate run must not take the server
    // down with it, nor rob the jobs behind it of their timers.
    it('does not let an immediate run that throws escape the start call, or strand the jobs after it', () =>
    {
        const flaky = countingJob('flaky', true, { answer: throws });
        const sweep = countingJob('sweep', true);
        manager.register(flaky.job);
        manager.register(sweep.job);

        expect(() => manager.startTimers()).not.toThrow();

        expect(flaky.entered()).toBe(1);
        expect(sweep.entered()).toBe(1);
    });

    it('leaves its interval unreffed, so recurring maintenance never holds the process open', () =>
    {
        const scheduling = vi.spyOn(globalThis, 'setInterval');
        manager.register(countingJob('prune', false).job);

        manager.startTimers();

        const handle = scheduling.mock.results[0]?.value as { hasRef : () => boolean };

        expect(handle.hasRef()).toBe(false);

        scheduling.mockRestore();
    });
});

//----------------------------------------------------------------------------------------------------------------------

describe('TimerManager.stopTimers', () =>
{
    it('stops every job it started', async () =>
    {
        const sweep = countingJob('sweep', false);
        const prune = countingJob('prune', false);
        manager.register(sweep.job);
        manager.register(prune.job);

        manager.startTimers();
        manager.stopTimers();

        await vi.advanceTimersByTimeAsync(INTERVAL_MS * 3);

        expect(sweep.entered()).toBe(0);
        expect(prune.entered()).toBe(0);
    });
});

//----------------------------------------------------------------------------------------------------------------------

// Individual control exists so a spec can drive one job without reasoning about the others, which only holds if
// naming one job leaves the rest exactly as they were.
describe('TimerManager.startTimer / stopTimer', () =>
{
    it('starts one job by name and leaves the others unscheduled', async () =>
    {
        const sweep = countingJob('sweep', true);
        const prune = countingJob('prune', true);
        manager.register(sweep.job);
        manager.register(prune.job);

        manager.startTimer('sweep');

        expect(sweep.entered()).toBe(1);

        await vi.advanceTimersByTimeAsync(INTERVAL_MS);

        expect(sweep.entered()).toBe(2);
        expect(prune.entered()).toBe(0);
    });

    it('stops one job by name and leaves the rest running', async () =>
    {
        const sweep = countingJob('sweep', false);
        const prune = countingJob('prune', false);
        manager.register(sweep.job);
        manager.register(prune.job);

        manager.startTimers();
        manager.stopTimer('prune');

        await vi.advanceTimersByTimeAsync(INTERVAL_MS);

        expect(sweep.entered()).toBe(1);
        expect(prune.entered()).toBe(0);
    });

    it('refuses a name that was never registered, rather than quietly doing nothing', () =>
    {
        expect(() => manager.startTimer('defragment')).toThrow(/defragment/);
        expect(() => manager.stopTimer('defragment')).toThrow(/defragment/);
    });
});

//----------------------------------------------------------------------------------------------------------------------

describe('TimerManager.register', () =>
{
    // A name is how a job is started and stopped on its own, so two jobs answering to one name would leave one of
    // them unreachable.
    it('refuses a second job under a name already taken, and keeps the job that holds it', async () =>
    {
        const sweep = countingJob('sweep', false);
        const impostor = countingJob('sweep', false);
        manager.register(sweep.job);

        expect(() => manager.register(impostor.job)).toThrow(/sweep/);

        manager.startTimers();
        await vi.advanceTimersByTimeAsync(INTERVAL_MS);

        expect(sweep.entered()).toBe(1);
        expect(impostor.entered()).toBe(0);
    });
});

//----------------------------------------------------------------------------------------------------------------------
