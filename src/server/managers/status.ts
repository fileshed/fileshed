//----------------------------------------------------------------------------------------------------------------------
// Status Manager
//
// The admin diagnostics readout behind GET /api/admin/status: the instance overview, the configured storage backends,
// and the last outcome of each background sweep. Admin-gated with the same role check the other admin capabilities
// apply; unlike listUsers it makes no better-auth call, so it forwards no headers -- the resolved session's role is the
// whole gate. Backends come from the blob RA (id/kind/default only, never the config blob, which can hold
// credentials); sweep outcomes come from the in-memory last-run tracker the timers feed, null until a sweep has run at
// least once this process.
//
// The email and sign-up switches are resolved per request rather than snapshotted at construction: both can be
// flipped without a restart, and a dashboard reporting a stale one is worse than no dashboard.
//----------------------------------------------------------------------------------------------------------------------

// Models
import {
    type AdminOverview,
    type AdminStatusResponse,
    type DatabaseKind,
    ForbiddenError,
    MS_PER_SECOND,
    MS_PER_WEEK,
} from '@fileshed/core';

// Managers
import type { LastRunTracker } from './lastRun.ts';

// Resource Access
import type { SessionUser } from '../resource-access/auth.ts';
import type { BlobRA } from '../resource-access/blob/index.ts';
import type { NodeRA } from '../resource-access/nodes/node.ts';
import type { ShareRA } from '../resource-access/shares/index.ts';
import type { UserRA } from '../resource-access/users/index.ts';

//----------------------------------------------------------------------------------------------------------------------

export interface StatusManagerDeps
{
    blob : BlobRA;
    nodes : NodeRA;
    users : UserRA;
    shares : ShareRA;
    tracker : LastRunTracker;

    version : string;
    databaseKind : DatabaseKind;
    startedAt : Date;
    activeProviders : number;

    emailEnabled : () => Promise<boolean>;
    signUpEnabled : () => Promise<boolean>;
}

//----------------------------------------------------------------------------------------------------------------------

export class StatusManager
{
    readonly #deps : StatusManagerDeps;

    constructor(deps : StatusManagerDeps)
    {
        this.#deps = deps;
    }

    async status(actor : SessionUser) : Promise<AdminStatusResponse>
    {
        if(actor.role !== 'admin')
        {
            throw new ForbiddenError('Admin access is required.');
        }

        const [ overview, backends ] = await Promise.all([
            this.#overview(),
            this.#deps.blob.listBackends(),
        ]);

        return {
            overview,
            backends,
            gc: this.#gcStatus(),
            trashPurge: this.#trashPurgeStatus(),
        };
    }

    async #overview() : Promise<AdminOverview>
    {
        const [ users, nodes, logicalBytes, trash, storage, accessRequestsPending, emailEnabled, signUpEnabled ]
            = await Promise.all([
                this.#deps.users.counts(new Date(Date.now() - MS_PER_WEEK)),
                this.#deps.nodes.liveTypeCounts(),
                this.#deps.nodes.totalOwnedBytes(),
                this.#deps.nodes.trashedFileTotals(),
                this.#deps.blob.storageTotals(),
                this.#deps.shares.pendingRequestCount(),
                this.#deps.emailEnabled(),
                this.#deps.signUpEnabled(),
            ]);

        return {
            users: {
                total: users.total,
                admins: users.admins,
                banned: users.banned,
                newThisWeek: users.createdSince,
            },
            nodes,
            storage: {
                logicalBytes,
                physicalBytes: storage.liveBytes,
                graveyardBytes: storage.graveyardBytes,
                graveyardCount: storage.graveyardCount,
            },
            trash,
            accessRequestsPending,
            instance: {
                version: this.#deps.version,
                databaseKind: this.#deps.databaseKind,
                // Clamped at zero: a host clock stepping backwards would otherwise report a negative uptime, which
                // the response codec rejects outright -- one bad NTP correction should not blank the whole readout.
                uptimeSeconds: Math.max(0, Math.floor((Date.now() - this.#deps.startedAt.getTime()) / MS_PER_SECOND)),
                emailEnabled,
                activeProviders: this.#deps.activeProviders,
                signUpEnabled,
            },
        };
    }

    #gcStatus() : AdminStatusResponse['gc']
    {
        const last = this.#deps.tracker.gc;
        return last === null ? null : { ranAt: last.at.toISOString(), summary: last.summary };
    }

    #trashPurgeStatus() : AdminStatusResponse['trashPurge']
    {
        const last = this.#deps.tracker.trashPurge;
        return last === null ? null : { ranAt: last.at.toISOString(), summary: last.summary };
    }
}

//----------------------------------------------------------------------------------------------------------------------
