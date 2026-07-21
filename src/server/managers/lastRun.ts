//----------------------------------------------------------------------------------------------------------------------
// Last-Run Tracker
//
// The in-memory record of the most recent background-sweep outcomes, surfaced by the admin status endpoint. Derived,
// never stored: the timers report each completed sweep here (startGcTimer/startTrashPurgeTimer's onComplete callback),
// and the status manager reads the latest. Null until a sweep has run at least once; a process restart resets it,
// because last-run status is diagnostics, not durable state.
//----------------------------------------------------------------------------------------------------------------------

// Managers
import type { GcSummary } from './gc.ts';
import type { TrashPurgeSummary } from './trashPurge.ts';

//----------------------------------------------------------------------------------------------------------------------

export interface LastRun<TSummary>
{
    summary : TSummary;
    at : Date;
}

export class LastRunTracker
{
    #gc : LastRun<GcSummary> | null = null;
    #trashPurge : LastRun<TrashPurgeSummary> | null = null;

    recordGc(summary : GcSummary) : void
    {
        this.#gc = { summary, at: new Date() };
    }

    recordTrashPurge(summary : TrashPurgeSummary) : void
    {
        this.#trashPurge = { summary, at: new Date() };
    }

    get gc() : LastRun<GcSummary> | null
    {
        return this.#gc;
    }

    get trashPurge() : LastRun<TrashPurgeSummary> | null
    {
        return this.#trashPurge;
    }
}

//----------------------------------------------------------------------------------------------------------------------
