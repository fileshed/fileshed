//----------------------------------------------------------------------------------------------------------------------
// Status Manager
//
// The admin diagnostics readout behind GET /api/admin/status: the configured storage backends and the last outcome of
// each background sweep. Admin-gated with the same role check the other admin capabilities apply; unlike listUsers it
// makes no better-auth call, so it forwards no headers -- the resolved session's role is the whole gate. Backends come
// from the blob RA (id/kind/default only, never the config blob, which can hold credentials); sweep outcomes come from
// the in-memory last-run tracker the timers feed, null until a sweep has run at least once this process.
//----------------------------------------------------------------------------------------------------------------------

// Models
import { type AdminStatusResponse, ForbiddenError } from '@fileshed/core';

// Managers
import type { LastRunTracker } from './lastRun.ts';

// Resource Access
import type { SessionUser } from '../resource-access/auth.ts';
import type { BlobRA } from '../resource-access/blob/index.ts';

//----------------------------------------------------------------------------------------------------------------------

export class StatusManager
{
    readonly #blob : BlobRA;
    readonly #tracker : LastRunTracker;

    constructor(blob : BlobRA, tracker : LastRunTracker)
    {
        this.#blob = blob;
        this.#tracker = tracker;
    }

    async status(actor : SessionUser) : Promise<AdminStatusResponse>
    {
        if(actor.role !== 'admin')
        {
            throw new ForbiddenError('Admin access is required.');
        }

        return {
            backends: await this.#blob.listBackends(),
            gc: this.#gcStatus(),
            trashPurge: this.#trashPurgeStatus(),
        };
    }

    #gcStatus() : AdminStatusResponse['gc']
    {
        const last = this.#tracker.gc;
        return last === null ? null : { ranAt: last.at.toISOString(), summary: last.summary };
    }

    #trashPurgeStatus() : AdminStatusResponse['trashPurge']
    {
        const last = this.#tracker.trashPurge;
        return last === null ? null : { ranAt: last.at.toISOString(), summary: last.summary };
    }
}

//----------------------------------------------------------------------------------------------------------------------
