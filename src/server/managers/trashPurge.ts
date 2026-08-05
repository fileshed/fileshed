//----------------------------------------------------------------------------------------------------------------------
// Trash Auto-Purge
//
// The scheduled sweep that permanently deletes trashed items whose grace window has lapsed. It lists only the expired
// trash ROOTS (NodeRA.expiredTrashRootIDs) and hands each to the node manager's ownerless purge, which deletes the
// subtree and graveyards its now-unreferenced blobs in one transaction. Because setTrashed stamps a whole subtree, a
// trashed child inside a trashed folder also carries a trashed_at -- but it is never a root, so the sweep skips it and
// the parent_id cascade takes it when its root goes. That is what keeps one trashed subtree from being deleted twice.
//----------------------------------------------------------------------------------------------------------------------

// Models
import { MS_PER_SECOND } from '@fileshed/core';

// Resource Access
import type { NodeRA } from '../resource-access/nodes/node.ts';

// Utils
import { getLogger } from '../utils/logger.ts';

//----------------------------------------------------------------------------------------------------------------------

const logger = getLogger('trash-purge');

//----------------------------------------------------------------------------------------------------------------------

// The one node-manager capability the sweep needs: permanently delete one expired trash root, ownerless and offer-free.
export interface TrashRootPurger
{
    purgeTrashedRoot(rootID : string) : Promise<void>;
}

export interface TrashPurgeDeps
{
    nodes : NodeRA;
    purger : TrashRootPurger;

    // Read at the start of each sweep, so an admin changing the retention window needs no restart.
    graceMs : () => Promise<number>;
}

export interface TrashPurgeSummary
{
    candidates : number;
    purged : number;
    failed : number;
}

//----------------------------------------------------------------------------------------------------------------------

export async function runTrashPurgeOnce(deps : TrashPurgeDeps) : Promise<TrashPurgeSummary>
{
    const cutoff = new Date(Date.now() - await deps.graceMs());
    const roots = await deps.nodes.expiredTrashRootIDs(cutoff);

    // Roots are disjoint subtrees (a trashed node whose parent is also trashed is never selected), so they purge
    // independently. One root's failure is logged and counted, never rethrown -- its own transaction rolled back, so
    // aborting the batch would only strand every remaining subtree over one bad one.
    const outcomes = await Promise.all(roots.map(async (rootID) =>
    {
        try
        {
            await deps.purger.purgeTrashedRoot(rootID);
            return 'purged';
        }
        catch(error)
        {
            logger.error({ err: error, nodeID: rootID }, 'trash purge failed for root');
            return 'failed';
        }
    }));

    const purged = outcomes.filter((outcome) => outcome === 'purged').length;
    const failed = outcomes.filter((outcome) => outcome === 'failed').length;

    const level = failed > 0 ? 'warn' : (roots.length > 0 ? 'info' : 'debug');
    logger[level]({ candidates: roots.length, purged, failed }, 'trash purge sweep complete');

    return { candidates: roots.length, purged, failed };
}

//----------------------------------------------------------------------------------------------------------------------

// Runs runTrashPurgeOnce shortly after boot and then on a fixed interval. The boot pass keeps short-uptime
// deployments honest: a box restarted more often than the interval would otherwise never purge, and thirty-day
// trash would live forever. Pure wiring beyond that: swallows a failed sweep with a log so one bad run never
// kills the timer, unrefs so it does not hold the process open, and reports each completed sweep's summary to
// `onComplete` (the status tracker). Returns a stop handle.
export function startTrashPurgeTimer(
    deps : TrashPurgeDeps,
    intervalMs : number,
    onComplete ?: (summary : TrashPurgeSummary) => void
) : () => void
{
    const sweep = () : void =>
    {
        runTrashPurgeOnce(deps)
            .then((summary) => onComplete?.(summary))
            .catch((error) => logger.error({ err: error }, 'trash purge sweep failed'));
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
