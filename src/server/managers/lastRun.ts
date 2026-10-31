//----------------------------------------------------------------------------------------------------------------------
// Last-Run Tracker
//
// In memory only, so a process restart resets it: last-run status is diagnostics, not durable state. The sweep manager
// reports every completed sweep here, scheduled or admin-triggered, and the status manager reads the latest.
//
// Each record hands back the entry it stored, so a caller reporting the run it just finished quotes the same instant
// the status endpoint will.
//----------------------------------------------------------------------------------------------------------------------

// Models
import type {
    AccountDeletionRunSummary,
    GcRunSummary,
    StagedUploadsRunSummary,
    SweepKind,
    TrashPurgeRunSummary,
} from '@fileshed/core';

//----------------------------------------------------------------------------------------------------------------------

// What each sweep kind answers with. There is no shape common to all of them, and flattening them into one would throw
// away the counts an admin is asking for.
export interface SweepSummaries
{
    gc : GcRunSummary;
    trashPurge : TrashPurgeRunSummary;
    stagedUploads : StagedUploadsRunSummary;
    accountDeletion : AccountDeletionRunSummary;
}

export interface LastRun<TSummary>
{
    summary : TSummary;
    at : Date;
}

export class LastRunTracker
{
    readonly #runs = new Map<SweepKind, LastRun<SweepSummaries[SweepKind]>>();

    record<K extends SweepKind>(kind : K, summary : SweepSummaries[K]) : LastRun<SweepSummaries[K]>
    {
        const run = { summary, at: new Date() };
        this.#runs.set(kind, run);

        return run;
    }

    last<K extends SweepKind>(kind : K) : LastRun<SweepSummaries[K]> | null
    {
        // record() is the only writer, and it files each kind's summary under that kind.
        return (this.#runs.get(kind) as LastRun<SweepSummaries[K]> | undefined) ?? null;
    }
}

//----------------------------------------------------------------------------------------------------------------------
