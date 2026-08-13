//----------------------------------------------------------------------------------------------------------------------
// Timer Manager
//
// Per-process, not cluster-wide: two servers each run their own copy of every job, as the in-memory ticket store and
// last-run tracker already do.
//
// Nothing here knows about latches, summaries, or who may run what -- the callback a job registers is already the
// guarded entry point of the manager that owns the work.
//----------------------------------------------------------------------------------------------------------------------

// Utils
import { getLogger } from '../utils/logger.ts';

//----------------------------------------------------------------------------------------------------------------------

const logger = getLogger('timers');

//----------------------------------------------------------------------------------------------------------------------

export interface TimerJob
{
    name : string;
    intervalMs : number;

    // Whether the first run happens on the start call rather than one interval later. Required, never defaulted:
    // either default is silent when it is wrong -- a job that should not run at boot would on every restart, or one
    // that should would never run at all on a deployment restarted more often than its interval.
    immediate : boolean;

    // Whatever it answers is discarded, and a promise is followed only as far as its failure. Thrown or rejected,
    // that failure is logged and the interval carries on.
    run : () => unknown;
}

interface Registration
{
    job : TimerJob;
    timer : ReturnType<typeof setInterval> | null;
}

//----------------------------------------------------------------------------------------------------------------------

export class TimerManager
{
    readonly #jobs = new Map<string, Registration>();

    register(job : TimerJob) : void
    {
        if(this.#jobs.has(job.name))
        {
            throw new Error(`A timer named "${ job.name }" is already registered.`);
        }

        this.#jobs.set(job.name, { job, timer: null });
    }

    // The composition root registers every job while it is still wiring managers and calls this once the graph is
    // whole, so no job can fire against a half-built one.
    startTimers() : void
    {
        for(const name of this.#jobs.keys()) { this.startTimer(name); }
    }

    stopTimers() : void
    {
        for(const name of this.#jobs.keys()) { this.stopTimer(name); }
    }

    // Idempotent: a job already scheduled is left where it is rather than scheduled a second time. The interval is
    // laid down before an immediate job runs, so a slow first run does not push the cadence out, and that run is
    // scheduled rather than awaited -- boot must not wait on a sweep.
    startTimer(name : string) : void
    {
        const entry = this.#registration(name);
        if(entry.timer !== null) { return; }

        entry.timer = setInterval(() => this.#tick(entry.job), entry.job.intervalMs);

        // Recurring maintenance is not a reason for the process to stay up.
        entry.timer.unref?.();

        if(entry.job.immediate) { this.#tick(entry.job); }
    }

    stopTimer(name : string) : void
    {
        const entry = this.#registration(name);
        if(entry.timer === null) { return; }

        clearInterval(entry.timer);
        entry.timer = null;
    }

    //------------------------------------------------------------------------------------------------------------------
    // Internals
    //------------------------------------------------------------------------------------------------------------------

    // Swallowed with a log however the job fails, whether it throws on the way in or rejects later. An escaping
    // rejection would reach the process unhandled, and the interval behind it would be dead from the first bad run.
    #tick(job : TimerJob) : void
    {
        try
        {
            void Promise.resolve(job.run()).catch((error) => this.#failed(job.name, error));
        }
        catch(error)
        {
            this.#failed(job.name, error);
        }
    }

    #failed(name : string, error : unknown) : void
    {
        logger.error({ err: error, timer: name }, 'Scheduled job failed');
    }

    #registration(name : string) : Registration
    {
        const entry = this.#jobs.get(name);
        if(entry === undefined) { throw new Error(`No timer named "${ name }".`); }

        return entry;
    }
}

//----------------------------------------------------------------------------------------------------------------------
