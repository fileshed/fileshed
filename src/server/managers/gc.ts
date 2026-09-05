//----------------------------------------------------------------------------------------------------------------------
// Blob GC
//
// The scheduled sweep that reclaims blob bytes, in two passes over the same rule. For each candidate the record row is
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
//
// The first pass is that sweep, and it is what makes the price payable. Bytes are published before the record that
// references them commits, so a crash there -- or any refusal inside the commit: the authoritative quota re-judge, the
// stale-edit guard, a failing FK -- leaves bytes on disk that no record accounts for. Nothing else can ever see them:
// candidacy is read from the record table, and a file with no row is invisible to it. So the reconciling pass finds
// them from the other side, from what is actually stored, and adopts each one into the graveyard rather than deleting
// it where it lies. Adoption is an insert that a concurrent commit for the same content either beats (leaving the live
// record alone) or loses to and then resurrects, which is what puts an orphan back under the one rule above instead of
// a second, racier way to delete bytes.
//----------------------------------------------------------------------------------------------------------------------

// Models
import { type GcRunSummary, ORPHAN_GRACE_MS } from '@fileshed/core';

// Resource Access
import type { BlobRA, GcCandidate } from '../resource-access/blob/index.ts';

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

// What one candidate cost the sweep. `kept` is a candidate that stopped being one before its row went -- resurrected
// under the graveyard pass, claimed by a live record under the reconciling one.
interface Removal
{
    outcome : 'deleted' | 'kept' | 'bytesFailed';
    bytes : number;
}

//----------------------------------------------------------------------------------------------------------------------
// Passes
//----------------------------------------------------------------------------------------------------------------------

// Row first, bytes second. A byte-delete failure is logged and counted, never rethrown -- the row is already gone, so
// aborting the batch would strand every remaining candidate over one bad file.
async function reclaim(blob : BlobRA, candidate : GcCandidate, cutoff : Date) : Promise<Removal>
{
    if(!await blob.hardDeleteRow(candidate.sha256, cutoff)) { return { outcome: 'kept', bytes: 0 }; }

    try
    {
        await blob.delete({ backendID: candidate.backendID, storageKey: candidate.storageKey });
        return { outcome: 'deleted', bytes: candidate.size };
    }
    catch(error)
    {
        logger.error({ err: error, sha256: candidate.sha256 }, 'GC byte delete failed; bytes leaked');
        return { outcome: 'bytesFailed', bytes: 0 };
    }
}

// Graveyarded records past their grace window. Candidates are independent (distinct sha256), so they collect
// concurrently; within each, the row goes before its bytes. A candidate resurrected between listing and here fails the
// conditional delete, so its bytes stay put.
async function reclaimGraveyarded(blob : BlobRA, cutoff : Date) : Promise<Removal[]>
{
    const candidates = await blob.gcCandidates(cutoff);

    return Promise.all(candidates.map((candidate) => reclaim(blob, candidate, cutoff)));
}

// Stored bytes no record accounts for, adopted into the graveyard and then collected under the same rule as everything
// else. Serial rather than concurrent: this walks the store itself, and a janitor reconciling in the background has no
// business saturating the backend. An orphan whose adoption is beaten by a live record is left exactly where it is.
async function reclaimOrphans(blob : BlobRA) : Promise<Removal[]>
{
    const cutoff = new Date(Date.now() - ORPHAN_GRACE_MS);
    const removals : Removal[] = [];

    for await (const orphan of blob.orphans(cutoff))
    {
        const adopted = await blob.adoptOrphan(orphan, cutoff);

        removals.push(adopted ? await reclaim(blob, orphan, new Date()) : { outcome: 'kept', bytes: 0 });
    }

    return removals;
}

//----------------------------------------------------------------------------------------------------------------------

export async function runGcOnce(deps : GcDeps) : Promise<GcRunSummary>
{
    const orphans = await reclaimOrphans(deps.blob);
    const graveyarded = await reclaimGraveyarded(deps.blob, new Date(Date.now() - await deps.graceMs()));

    const removals = [ ...orphans, ...graveyarded ];

    const deleted = removals.filter((removal) => removal.outcome === 'deleted');
    const kept = removals.filter((removal) => removal.outcome === 'kept').length;
    const bytesFailed = removals.filter((removal) => removal.outcome === 'bytesFailed').length;

    // Only bytes that actually left the store count as freed. A leaked candidate's space is still occupied, and
    // reporting it as reclaimed would tell an admin they got back room they can't use.
    const bytesFreed = deleted.reduce((total, removal) => total + removal.bytes, 0);

    const summary = { candidates: removals.length, deleted: deleted.length, kept, bytesFailed, bytesFreed };

    // Orphans are broken out of the log rather than the summary: an instance that keeps finding stored bytes its
    // records never knew about is describing a bug, and that reads very differently from ordinary collection.
    const level = bytesFailed > 0 ? 'warn' : (removals.length > 0 ? 'info' : 'debug');
    logger[level]({ ...summary, orphans: orphans.length }, 'GC sweep complete');

    return summary;
}

//----------------------------------------------------------------------------------------------------------------------
