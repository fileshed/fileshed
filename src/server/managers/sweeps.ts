//----------------------------------------------------------------------------------------------------------------------
// Sweep Manager
//
// Within one process, the only way a storage-reclaiming sweep starts, whether a scheduled tick asks or an admin does.
// That is the whole point of the class: the in-flight latch can only answer "already running" honestly if both callers
// pass through it, and the run an admin collides with is nearly always the scheduled one rather than a second button
// press. The latch is per-process; two servers against one store sweep on their own timers, and what keeps that from
// corrupting anything is each sweep's own rule -- a conditional delete, a cutoff nothing live can be behind -- not
// this class.
//
// The two callers differ only in what a collision means. An admin is told (409) -- they asked for something specific
// and deserve to know it did not happen. A timer tick is skipped and logged at debug, because the interval will come
// round again and a sweep still running has nothing to add.
//----------------------------------------------------------------------------------------------------------------------

// Models
import {
    ConflictError,
    NotFoundError,
    type SweepKind,
    type SweepRunResponse,
    isOneOf,
    sweepKinds,
} from '@fileshed/core';

// Managers
import type { LastRunTracker, SweepSummaries } from './lastRun.ts';

// Engines
import { assertAdmin } from '../engines/adminAccess.ts';

// Resource Access
import type { SessionUser } from '../resource-access/auth/instance.ts';

// Utils
import { getLogger } from '../utils/logger.ts';

//----------------------------------------------------------------------------------------------------------------------

const logger = getLogger('sweeps');

const sweepLabels : Record<SweepKind, string> = {
    gc: 'garbage collection',
    trashPurge: 'trash purge',
    stagedUploads: 'abandoned upload',
    accountDeletion: 'account deletion',
};

//----------------------------------------------------------------------------------------------------------------------

// The sweeps themselves, already bound to their dependencies by the composition root, each answering its own summary.
export type SweepRunners = { [K in SweepKind] : () => Promise<SweepSummaries[K]> };

// The SweepRunResponse variant for the kind a run was started for.
type SweepRunResponseFor<K extends SweepKind>
    = { [P in K] : { sweep : P; ranAt : string; summary : SweepSummaries[P] } }[K];

export interface SweepManagerDeps
{
    runners : SweepRunners;
    tracker : LastRunTracker;
}

//----------------------------------------------------------------------------------------------------------------------

export class SweepManager
{
    readonly #runners : SweepRunners;
    readonly #tracker : LastRunTracker;
    readonly #inFlight = new Set<SweepKind>();

    constructor(deps : SweepManagerDeps)
    {
        this.#runners = deps.runners;
        this.#tracker = deps.tracker;
    }

    // Run one sweep now and answer with what it reclaimed. The gate order matters: a caller who is not an admin is
    // refused before the sweep name is judged, so a 404 never confirms which sweeps this instance has.
    async run(user : SessionUser, sweep : string) : Promise<SweepRunResponse>
    {
        assertAdmin(user);

        const kind = this.#asSweepKind(sweep);

        if(this.#inFlight.has(kind))
        {
            throw new ConflictError(
                'sweep.alreadyRunning',
                `The ${ sweepLabels[kind] } sweep is already running.`
            );
        }

        logger.info({ sweep: kind, userID: user.id }, 'Sweep requested by an admin');

        return this.#start(kind);
    }

    // What the registered timer job calls, and the reason this manager needs no timer of its own: a tick is the same
    // latched start an admin gets, so the two can never double up.
    async runScheduled(kind : SweepKind) : Promise<void>
    {
        if(this.#inFlight.has(kind))
        {
            logger.debug({ sweep: kind }, 'Sweep still running; skipping this tick');
            return;
        }

        await this.#start(kind);
    }

    //------------------------------------------------------------------------------------------------------------------
    // Internals
    //------------------------------------------------------------------------------------------------------------------

    // Claim the latch and run. Both callers reach here having just tested the set with no await in between, which is
    // what makes the check-and-set atomic -- there is no point at which a second caller can observe an unclaimed slot
    // for a sweep that has already started. The slot clears on failure as well as success, so a throwing sweep never
    // wedges the latch shut for the life of the process.
    #start(kind : SweepKind) : Promise<SweepRunResponse>
    {
        const run = this.#execute(kind);
        this.#inFlight.add(kind);

        const release = () : void => void this.#inFlight.delete(kind);
        run.then(release, release);

        return run;
    }

    async #execute<K extends SweepKind>(kind : K) : Promise<SweepRunResponseFor<K>>
    {
        const last = this.#tracker.record(kind, await this.#runners[kind]());

        return { sweep: kind, ranAt: last.at.toISOString(), summary: last.summary };
    }

    #asSweepKind(sweep : string) : SweepKind
    {
        if(!isOneOf(sweepKinds, sweep)) { throw new NotFoundError(`No sweep named "${ sweep }".`); }

        return sweep;
    }
}

//----------------------------------------------------------------------------------------------------------------------
