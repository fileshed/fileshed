//----------------------------------------------------------------------------------------------------------------------
// Last-Run Tracker
//
// The in-memory record of the most recent background-sweep outcomes, surfaced by the admin status endpoint. Derived,
// never stored: the sweep manager reports every completed sweep here, scheduled or admin-triggered alike, and the
// status manager reads the latest. Null until a sweep has run at least once; a process restart resets it, because
// last-run status is diagnostics, not durable state.
//
// Each record hands back the entry it stored, so a caller reporting the run it just finished quotes the same instant
// the status endpoint will.
//----------------------------------------------------------------------------------------------------------------------

// Models
import type { GcRunSummary, PartialsRunSummary, TrashPurgeRunSummary } from '@fileshed/core';

//----------------------------------------------------------------------------------------------------------------------

export interface LastRun<TSummary>
{
    summary : TSummary;
    at : Date;
}

export class LastRunTracker
{
    #gc : LastRun<GcRunSummary> | null = null;
    #trashPurge : LastRun<TrashPurgeRunSummary> | null = null;
    #partials : LastRun<PartialsRunSummary> | null = null;

    recordGc(summary : GcRunSummary) : LastRun<GcRunSummary>
    {
        this.#gc = { summary, at: new Date() };

        return this.#gc;
    }

    recordTrashPurge(summary : TrashPurgeRunSummary) : LastRun<TrashPurgeRunSummary>
    {
        this.#trashPurge = { summary, at: new Date() };

        return this.#trashPurge;
    }

    recordPartials(summary : PartialsRunSummary) : LastRun<PartialsRunSummary>
    {
        this.#partials = { summary, at: new Date() };

        return this.#partials;
    }

    get gc() : LastRun<GcRunSummary> | null
    {
        return this.#gc;
    }

    get trashPurge() : LastRun<TrashPurgeRunSummary> | null
    {
        return this.#trashPurge;
    }

    get partials() : LastRun<PartialsRunSummary> | null
    {
        return this.#partials;
    }
}

//----------------------------------------------------------------------------------------------------------------------
