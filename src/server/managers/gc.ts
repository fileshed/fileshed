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
import type { GcRunSummary } from '@fileshed/core';

// Resource Access
import { BlobRA } from '../resource-access/blob/index.ts';

// Utils
import { getLogger } from '../utils/logger.ts';

//----------------------------------------------------------------------------------------------------------------------

const logger = getLogger('gc');

//----------------------------------------------------------------------------------------------------------------------

export interface GcDeps
{
    blob : BlobRA;

    // Read at the start of each sweep, so an admin changing the grace window needs no restart.
    graceMs : () => Promise<number>;
}

//----------------------------------------------------------------------------------------------------------------------

export async function runGcOnce(deps : GcDeps) : Promise<GcRunSummary>
{
    const cutoff = new Date(Date.now() - await deps.graceMs());
    const candidates = await deps.blob.gcCandidates(cutoff);

    // Candidates are independent (distinct sha256), so they collect concurrently; within each, the row goes before its
    // bytes. A candidate resurrected between listing and here fails the conditional delete, so its bytes stay put.
    // A byte-delete failure is logged and counted, never rethrown -- the row is already gone (row-first design), so
    // aborting the batch would strand every remaining candidate over one bad file.
    const removals = await Promise.all(candidates.map(async (candidate) =>
    {
        if(!await deps.blob.hardDeleteRow(candidate.sha256, cutoff)) { return { outcome: 'kept' as const, bytes: 0 }; }

        try
        {
            await deps.blob.delete({ backendID: candidate.backendID, storageKey: candidate.storageKey });
            return { outcome: 'deleted' as const, bytes: candidate.size };
        }
        catch(error)
        {
            logger.error({ err: error, sha256: candidate.sha256 }, 'GC byte delete failed; bytes leaked');
            return { outcome: 'bytesFailed' as const, bytes: 0 };
        }
    }));

    const deleted = removals.filter((removal) => removal.outcome === 'deleted');
    const kept = removals.filter((removal) => removal.outcome === 'kept').length;
    const bytesFailed = removals.filter((removal) => removal.outcome === 'bytesFailed').length;

    // Only bytes that actually left the store count as freed. A leaked candidate's space is still occupied, and
    // reporting it as reclaimed would tell an admin they got back room they can't use.
    const bytesFreed = deleted.reduce((total, removal) => total + removal.bytes, 0);

    const summary = { candidates: candidates.length, deleted: deleted.length, kept, bytesFailed, bytesFreed };

    const level = bytesFailed > 0 ? 'warn' : (candidates.length > 0 ? 'info' : 'debug');
    logger[level](summary, 'GC sweep complete');

    return summary;
}

//----------------------------------------------------------------------------------------------------------------------
