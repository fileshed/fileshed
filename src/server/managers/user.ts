//----------------------------------------------------------------------------------------------------------------------
// User Manager
//
// The email lookup is exact-match only, so it never enumerates accounts by prefix or substring.
//----------------------------------------------------------------------------------------------------------------------

// Models
import {
    type AccountDeletionSchedule,
    type MeResponse,
    NotFoundError,
    type UpdatePreferencesRequest,
    type UserSummary,
    toUserPreferences,
} from '@fileshed/core';

// Engines
import { applyPreferencesPatch } from '../engines/preferences.ts';
import { effectiveQuota } from '../engines/quota.ts';

// Resource Access
import type { SessionUser } from '../resource-access/auth/instance.ts';
import type { DatabaseHandle } from '../resource-access/database/database.ts';
import { NodeRA } from '../resource-access/nodes/index.ts';
import { UserRA } from '../resource-access/users/index.ts';

// Utils
import { avatarImage } from '../utils/avatarImage.ts';

//----------------------------------------------------------------------------------------------------------------------

export interface UserManagerDeps
{
    handle : DatabaseHandle;

    // Each read at every use, so an admin moving a setting changes the very next profile.
    defaultQuota : () => Promise<number>;
    trashRetentionDays : () => Promise<number>;
    accountDeletionDays : () => Promise<number>;

    // The caller's own pending deletion, or null when they have none -- what /api/me reports so a client can land
    // them on the interstitial instead of their drive.
    deletionSchedule : (userID : string) => Promise<AccountDeletionSchedule | null>;
}

//----------------------------------------------------------------------------------------------------------------------

export class UserManager
{
    readonly #users : UserRA;
    readonly #nodes : NodeRA;
    readonly #deps : UserManagerDeps;

    constructor(deps : UserManagerDeps)
    {
        this.#users = new UserRA(deps.handle);
        this.#nodes = new NodeRA(deps.handle);
        this.#deps = deps;
    }

    async me(user : SessionUser) : Promise<MeResponse>
    {
        // The limit shown is resolved the same way the next upload's is, so the gauge and the quota check agree.
        const [ used, limit, stored, avatarSha256, trashRetentionDays, accountDeletionDays, defaultQuota, deletion ]
            = await Promise.all([
                this.#nodes.ownedBytes(user.id),
                this.#users.quotaLimitOf(user.id),
                this.#users.preferencesOf(user.id),
                this.#users.avatarSha256Of(user.id),
                this.#deps.trashRetentionDays(),
                this.#deps.accountDeletionDays(),
                this.#deps.defaultQuota(),
                this.#deps.deletionSchedule(user.id),
            ]);

        return {
            id: user.id,
            email: user.email,
            name: user.name,
            role: user.role === 'admin' ? 'admin' : 'user',
            quota: { used, effective: effectiveQuota(limit, defaultQuota), limit },
            limits: { trashRetentionDays, accountDeletionDays },
            preferences: toUserPreferences(stored),
            image: avatarImage(avatarSha256),
            createdAt: new Date(user.createdAt).toISOString(),
            deletion,
        };
    }

    // Merge a preferences patch into the caller's stored blob and answer the refreshed profile. The stored blob is read
    // fresh and merged key-wise, so every key the patch does not mention -- known or unknown -- survives the write.
    async updatePreferences(user : SessionUser, patch : UpdatePreferencesRequest) : Promise<MeResponse>
    {
        const stored = await this.#users.preferencesOf(user.id);
        await this.#users.setPreferences(user.id, applyPreferencesPatch(stored, patch));

        return this.me(user);
    }

    async lookupByEmail(email : string) : Promise<UserSummary>
    {
        const summary = await this.#users.findSummaryByEmail(email);
        if(summary === undefined) { throw new NotFoundError('No user with that email.'); }

        return summary;
    }
}

//----------------------------------------------------------------------------------------------------------------------
