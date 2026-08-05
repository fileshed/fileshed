//----------------------------------------------------------------------------------------------------------------------
// Blob GC
//
// The scheduled sweep that reclaims graveyarded blobs past their grace window. For each candidate the record row is
// hard-deleted FIRST, conditionally (`deleted_at < cutoff` re-checked at delete time), and only when that delete
// actually removes the row are the bytes deleted.
//
// The order is deliberate and is the opposite of "bytes then row". The row's conditional delete is the serialization
// point of the concurrency rule: a claim that resurrects the blob clears deleted_at inside its own transaction,
// so it either commits before this delete (which then matches nothing and the live blob survives) or after (the row is
// already gone, so the claim's resurrect updates nothing and its node insert fails the blob_id FK). Deleting the bytes
// first would leave a window where a resurrected, still-referenced blob loses its bytes -- data corruption. The price
// of row-first is that a crash between the two deletes orphans the bytes on disk: a recoverable space leak, never a
// dangling reference. A leak we can sweep; corruption we cannot.
//----------------------------------------------------------------------------------------------------------------------

// Models
import { MS_PER_SECOND } from '@fileshed/core';

// Resource Access
import { BlobRA } from '../resource-access/blob/index.ts';
import type { DatabaseHandle } from '../resource-access/database/database.ts';

// Utils
import { getLogger } from '../utils/logger.ts';

//----------------------------------------------------------------------------------------------------------------------

const logger = getLogger('gc');

//----------------------------------------------------------------------------------------------------------------------

export interface GcDeps
{
    handle : DatabaseHandle;
    blob : BlobRA;

    // Read at the start of each sweep, so an admin changing the grace window needs no restart.
    graceMs : () => Promise<number>;
}

export interface GcSummary
{
    candidates : number;
    deleted : number;
    kept : number;
    bytesFailed : number;
}

//----------------------------------------------------------------------------------------------------------------------

export async function runGcOnce(deps : GcDeps) : Promise<GcSummary>
{
    const cutoff = new Date(Date.now() - await deps.graceMs());
    const candidates = await deps.blob.gcCandidates(cutoff);

    // Candidates are independent (distinct sha256), so they collect concurrently; within each, the row goes before its
    // bytes. A candidate resurrected between listing and here fails the conditional delete, so its bytes stay put.
    // A byte-delete failure is logged and counted, never rethrown -- the row is already gone (row-first design), so
    // aborting the batch would strand every remaining candidate over one bad file.
    const removals = await Promise.all(candidates.map(async (candidate) =>
    {
        if(!await deps.blob.hardDeleteRow(candidate.sha256, cutoff)) { return 'kept'; }

        try
        {
            await deps.blob.delete({ backendID: candidate.backendID, storageKey: candidate.storageKey });
            return 'deleted';
        }
        catch(error)
        {
            logger.error({ err: error, sha256: candidate.sha256 }, 'GC byte delete failed; bytes leaked');
            return 'bytesFailed';
        }
    }));

    const deleted = removals.filter((removal) => removal === 'deleted').length;
    const kept = removals.filter((removal) => removal === 'kept').length;
    const bytesFailed = removals.filter((removal) => removal === 'bytesFailed').length;

    const level = bytesFailed > 0 ? 'warn' : (candidates.length > 0 ? 'info' : 'debug');
    logger[level]({ candidates: candidates.length, deleted, kept, bytesFailed }, 'GC sweep complete');

    return { candidates: candidates.length, deleted, kept, bytesFailed };
}

//----------------------------------------------------------------------------------------------------------------------

// Runs runGcOnce shortly after boot and then on a fixed interval. The boot pass matters more than it looks: a
// deployment restarted more often than the interval would otherwise never collect at all, and the admin status
// page would report an eternal "never". Pure wiring beyond that: swallows a failed sweep with a log so one bad
// run never kills the timer, unrefs so it does not hold the process open, and reports each completed sweep's
// summary to `onComplete` (the status tracker). Returns a stop handle.
export function startGcTimer(
    deps : GcDeps,
    intervalMs : number,
    onComplete ?: (summary : GcSummary) => void
) : () => void
{
    const sweep = () : void =>
    {
        runGcOnce(deps)
            .then((summary) => onComplete?.(summary))
            .catch((error) => logger.error({ err: error }, 'GC sweep failed'));
    };

    const kickoff = setTimeout(sweep, MS_PER_SECOND);
    kickoff.unref?.();

    const timer = setInterval(sweep, intervalMs);
    timer.unref?.();

    return () =>
    {
        clearTimeout(kickoff);
        clearInterval(timer);
    };
}

//----------------------------------------------------------------------------------------------------------------------
