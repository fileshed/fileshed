//----------------------------------------------------------------------------------------------------------------------
// Sweep Manager
//
// Within one process, the only way the GC and trash-purge sweeps start, whether their timer asks or an admin does.
// That is the whole point of the class: the in-flight latch can only answer "already running" honestly if both callers
// pass through it, and the run an admin collides with is nearly always the scheduled one rather than a second button
// press. The latch is per-process; two servers against one database sweep on their own timers, and what keeps that
// from corrupting anything is the conditional delete inside each sweep, not this class.
//
// The two callers differ only in what a collision means. An admin is told (409) -- they asked for something specific
// and deserve to know it did not happen. A timer tick is skipped and logged at debug, because the interval will come
// round again and a sweep still running has nothing to add.
//----------------------------------------------------------------------------------------------------------------------

// Models
import {
    ConflictError,
    ForbiddenError,
    type GcRunSummary,
    MS_PER_SECOND,
    NotFoundError,
    type SweepKind,
    type SweepRunResponse,
    type TrashPurgeRunSummary,
    sweepKinds,
} from '@fileshed/core';

// Managers
import type { LastRunTracker } from './lastRun.ts';

// Resource Access
import type { SessionUser } from '../resource-access/auth.ts';

// Utils
import { getLogger } from '../utils/logger.ts';

//----------------------------------------------------------------------------------------------------------------------

const logger = getLogger('sweeps');

const sweepLabels : Record<SweepKind, string> = {
    gc: 'garbage collection',
    trashPurge: 'trash purge',
};

//----------------------------------------------------------------------------------------------------------------------

// The sweeps themselves, already bound to their dependencies by the composition root. Each answers its own summary --
// there is no shape common to all of them, and flattening them into one would throw away the counts an admin is
// asking for.
export interface SweepRunners
{
    gc : () => Promise<GcRunSummary>;
    trashPurge : () => Promise<TrashPurgeRunSummary>;
}

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
    async run(actor : SessionUser, sweep : string) : Promise<SweepRunResponse>
    {
        if(actor.role !== 'admin')
        {
            throw new ForbiddenError('Admin access is required.');
        }

        const kind = this.#asSweepKind(sweep);

        if(this.#inFlight.has(kind))
        {
            throw new ConflictError(
                'sweep.alreadyRunning',
                `The ${ sweepLabels[kind] } sweep is already running.`
            );
        }

        logger.info({ sweep: kind, actorID: actor.id }, 'Sweep requested by an admin');

        return this.#start(kind);
    }

    // Runs every sweep shortly after boot and then on a fixed interval. The boot pass matters more than it looks: a
    // deployment restarted more often than the interval would otherwise never sweep at all, and the admin status page
    // would report an eternal "never". Returns a handle that stops all of them.
    startTimers(intervalMs : number) : () => void
    {
        const stops = sweepKinds.map((kind) => this.#schedule(kind, intervalMs));

        return () =>
        {
            for(const stop of stops) { stop(); }
        };
    }

    //------------------------------------------------------------------------------------------------------------------
    // Internals
    //------------------------------------------------------------------------------------------------------------------

    #schedule(kind : SweepKind, intervalMs : number) : () => void
    {
        const tick = () : void =>
        {
            if(this.#inFlight.has(kind))
            {
                logger.debug({ sweep: kind }, 'Sweep still running; skipping this tick');
                return;
            }

            // Swallowed with a log so one bad run never kills the timer that runs it.
            void this.#start(kind).catch((error) => logger.error({ err: error, sweep: kind }, 'Sweep failed'));
        };

        const kickoff = setTimeout(tick, MS_PER_SECOND);
        kickoff.unref?.();

        const timer = setInterval(tick, intervalMs);
        timer.unref?.();

        return () =>
        {
            clearTimeout(kickoff);
            clearInterval(timer);
        };
    }

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

    async #execute(kind : SweepKind) : Promise<SweepRunResponse>
    {
        switch (kind)
        {
            case 'gc':
            {
                const last = this.#tracker.recordGc(await this.#runners.gc());

                return { sweep: 'gc', ranAt: last.at.toISOString(), summary: last.summary };
            }

            case 'trashPurge':
            {
                const last = this.#tracker.recordTrashPurge(await this.#runners.trashPurge());

                return { sweep: 'trashPurge', ranAt: last.at.toISOString(), summary: last.summary };
            }
        }
    }

    #asSweepKind(sweep : string) : SweepKind
    {
        if(!(sweepKinds as readonly string[]).includes(sweep))
        {
            throw new NotFoundError(`No sweep named "${ sweep }".`);
        }

        return sweep as SweepKind;
    }
}

//----------------------------------------------------------------------------------------------------------------------
