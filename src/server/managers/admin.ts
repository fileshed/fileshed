//----------------------------------------------------------------------------------------------------------------------
// Admin Manager
//
// The business layer behind the gated admin surface. The admin() plugin's HTTP endpoints are blocked externally
// (app.ts), so every admin capability reaches better-auth through this manager's in-process auth.api.* calls, behind
// our own role check. This listUsers path is the template future admin routes (ban, quota, impersonate) copy.
//
// Authorization lives here rather than in the regulation engine: "is this account an admin?" is plain RBAC on the
// account role, not the cross-record data legality the regulation engine models -- adding a judge there would overload
// its purpose. The check is a single condition, enforced once, at the manager boundary.
//----------------------------------------------------------------------------------------------------------------------

import { type UserProfile, parseUserProfile } from '@fileshed/core';

// Resource Access
import type { Auth, SessionUser } from '../resource-access/auth.ts';

// Managers
import { ForbiddenError } from './errors.ts';

//----------------------------------------------------------------------------------------------------------------------

// listUsers types its rows as the admin plugin's UserWithRole, which does not statically carry app-level
// additionalFields; quota_limit is present at runtime (it is a real column), so the type is widened to admit it.
type AdminUser = Awaited<ReturnType<Auth['api']['listUsers']>>['users'][number] & { quotaLimit ?: number | null };

// better-auth's user carries plugin/admin fields (banned, banReason, ...) the app profile does not; the codec is the
// boundary that narrows it to the domain shape and validates the role enum.
function toUserProfile(user : AdminUser) : UserProfile
{
    return parseUserProfile({
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        quotaLimit: user.quotaLimit ?? null,
        createdAt: new Date(user.createdAt),
    });
}

//----------------------------------------------------------------------------------------------------------------------

export class AdminManager
{
    readonly #auth : Auth;

    constructor(auth : Auth)
    {
        this.#auth = auth;
    }

    async listUsers(actor : SessionUser, headers : Headers) : Promise<UserProfile[]>
    {
        if(actor.role !== 'admin')
        {
            throw new ForbiddenError('Admin access is required.');
        }

        // Forward the caller's headers: better-auth's own admin guard re-checks the session, and the caller is the
        // admin we just authorized, so it passes -- the gated capability executing through the one sanctioned surface.
        const { users } = await this.#auth.api.listUsers({ query: { limit: 500 }, headers });

        return users.map(toUserProfile);
    }
}

//----------------------------------------------------------------------------------------------------------------------
