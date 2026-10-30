//----------------------------------------------------------------------------------------------------------------------
// Status Manager
//
// This manager makes no better-auth call, so it forwards no headers: the resolved session's role is the whole check.
// Backends are reported as id, kind and default only, never the config blob, which can hold credentials.
//
// The email and sign-up switches are resolved per request rather than snapshotted at construction: both can be
// flipped without a restart, and a dashboard reporting a stale one is worse than no dashboard.
//----------------------------------------------------------------------------------------------------------------------

// Models
import {
    type AdminOverview,
    type AdminStatusResponse,
    MS_PER_SECOND,
    MS_PER_WEEK,
    type SweepKind,
} from '@fileshed/core';

// Managers
import type { LastRunTracker, SweepSummaries } from './lastRun.ts';

// Engines
import { assertAdmin } from '../engines/adminAccess.ts';

// Resource Access
import type { SessionUser } from '../resource-access/auth/instance.ts';
import type { BlobRA } from '../resource-access/blob/index.ts';
import type { DatabaseHandle } from '../resource-access/database/database.ts';
import { NodeRA } from '../resource-access/nodes/index.ts';
import { ShareRA } from '../resource-access/shares/index.ts';
import { UserRA } from '../resource-access/users/index.ts';

// Utils
import type { BuildInfo } from '../utils/version.ts';

//----------------------------------------------------------------------------------------------------------------------

export interface StatusManagerDeps
{
    handle : DatabaseHandle;
    blob : BlobRA;
    tracker : LastRunTracker;

    build : BuildInfo;
    startedAt : Date;
    activeProviders : number;

    emailEnabled : () => Promise<boolean>;
    signUpEnabled : () => Promise<boolean>;
}

//----------------------------------------------------------------------------------------------------------------------

export class StatusManager
{
    readonly #deps : StatusManagerDeps;
    readonly #nodes : NodeRA;
    readonly #users : UserRA;
    readonly #shares : ShareRA;

    constructor(deps : StatusManagerDeps)
    {
        this.#deps = deps;
        this.#nodes = new NodeRA(deps.handle);
        this.#users = new UserRA(deps.handle);
        this.#shares = new ShareRA(deps.handle);
    }

    async status(user : SessionUser) : Promise<AdminStatusResponse>
    {
        assertAdmin(user);

        const [ overview, backends ] = await Promise.all([
            this.#overview(),
            this.#deps.blob.listBackends(),
        ]);

        return {
            overview,
            backends,
            gc: this.#lastRun('gc'),
            trashPurge: this.#lastRun('trashPurge'),
            stagedUploads: this.#lastRun('stagedUploads'),
            accountDeletion: this.#lastRun('accountDeletion'),
        };
    }

    async #overview() : Promise<AdminOverview>
    {
        const [ users, nodes, logicalBytes, trash, storage, accessRequestsPending, emailEnabled, signUpEnabled ]
            = await Promise.all([
                this.#users.counts(new Date(Date.now() - MS_PER_WEEK)),
                this.#nodes.liveTypeCounts(),
                this.#nodes.totalOwnedBytes(),
                this.#nodes.trashedFileTotals(),
                this.#deps.blob.storageTotals(),
                this.#shares.pendingRequestCount(),
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
                version: this.#deps.build.version,
                commit: this.#deps.build.commit,
                branch: this.#deps.build.branch,
                databaseKind: this.#deps.handle.kind,
                // Clamped at zero: a host clock stepping backwards would otherwise report a negative uptime, which
                // the response codec rejects outright -- one bad NTP correction should not blank the whole readout.
                uptimeSeconds: Math.max(0, Math.floor((Date.now() - this.#deps.startedAt.getTime()) / MS_PER_SECOND)),
                emailEnabled,
                activeProviders: this.#deps.activeProviders,
                signUpEnabled,
            },
        };
    }

    #lastRun<K extends SweepKind>(kind : K) : { ranAt : string; summary : SweepSummaries[K] } | null
    {
        const last = this.#deps.tracker.last(kind);
        return last === null ? null : { ranAt: last.at.toISOString(), summary: last.summary };
    }
}

//----------------------------------------------------------------------------------------------------------------------
