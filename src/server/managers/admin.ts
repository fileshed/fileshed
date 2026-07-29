//----------------------------------------------------------------------------------------------------------------------
// Admin Manager
//
// The business layer behind the gated admin surface. The admin() plugin's HTTP endpoints are blocked externally
// (app.ts), so every admin capability reaches better-auth through this manager's in-process auth.api.* calls, behind
// our own role check. The caller's headers ride along on every call: better-auth's own admin guard re-checks the
// session, and the caller is the admin we just authorized -- the gated capability executing through the one
// sanctioned surface.
//
// Authorization lives here rather than in the regulation engine: "is this account an admin?" is plain RBAC on the
// account role, not the cross-record data legality the regulation engine models -- adding a judge there would overload
// its purpose. The check is a single condition, enforced once, at the manager boundary.
//----------------------------------------------------------------------------------------------------------------------

import { isAPIError } from 'better-auth/api';

import {
    type AdminUserSearchField,
    type AdminUserSortKey,
    BadRequestError,
    type BanUserRequest,
    DEFAULT_LIST_USERS_LIMIT,
    ForbiddenError,
    MAX_LIST_USERS_LIMIT,
    MS_PER_DAY,
    MS_PER_SECOND,
    NotFoundError,
    type UserProfile,
    type UserRole,
    parseUserProfile,
} from '@fileshed/core';

// Resource Access
import type { Auth, SessionUser } from '../resource-access/auth.ts';

//----------------------------------------------------------------------------------------------------------------------

// Bounds for listUsers pagination: a caller-supplied limit is clamped into [1, MAX_LIST_USERS_LIMIT] rather than
// rejected -- pagination is a convenience the caller doesn't have to get exactly right, not a wire-contract violation
// worth a 400. A missing limit gets DEFAULT_LIST_USERS_LIMIT; offset just floors at 0.

function clamp(value : number, min : number, max : number) : number
{
    return Math.min(Math.max(value, min), max);
}

export interface ListUsersOptions
{
    limit ?: number;
    offset ?: number;
    search ?: string;
    searchField ?: AdminUserSearchField;
    sortBy ?: AdminUserSortKey;
    sortDirection ?: 'asc' | 'desc';
}

// A listed or acted-on user: the profile plus the bytes their owned files charge. Every admin response row carries
// both, so the client never composes them ad hoc.
export interface AdminUserEntry
{
    profile : UserProfile;
    usedBytes : number;
}

export interface AdminUserPage
{
    users : AdminUserEntry[];
    total : number;
    limit : number;
    offset : number;
}

// The bytes charged to each of a set of owners; owners absent from the map charge nothing. bootApp backs this with
// the node store's grouped aggregate; auth-only compositions (no node store) answer an empty map.
export type UsageResolver = (ownerIDs : string[]) => Promise<Map<string, number>>;

export interface AdminManagerDeps
{
    auth : Auth;
    usage : UsageResolver;
}

// listUsers types its rows as the admin plugin's UserWithRole, which does not statically carry app-level
// additionalFields; quota_limit is present at runtime (it is a real column), so the type is widened to admit it.
type AdminUser = Awaited<ReturnType<Auth['api']['listUsers']>>['users'][number] & { quotaLimit ?: number | null };

// better-auth's user carries plugin fields the codec narrows and validates; the ban trio is normalized here because
// the plugin leaves them null/undefined on accounts never banned, and banExpires crosses some adapters as a string.
function toUserProfile(user : AdminUser) : UserProfile
{
    return parseUserProfile({
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        quotaLimit: user.quotaLimit ?? null,
        banned: user.banned === true,
        banReason: user.banReason ?? null,
        banExpires: user.banExpires ? new Date(user.banExpires) : null,
        createdAt: new Date(user.createdAt),
    });
}

//----------------------------------------------------------------------------------------------------------------------

export class AdminManager
{
    readonly #auth : Auth;
    readonly #usage : UsageResolver;

    constructor(deps : AdminManagerDeps)
    {
        this.#auth = deps.auth;
        this.#usage = deps.usage;
    }

    #requireAdmin(actor : SessionUser) : void
    {
        if(actor.role !== 'admin')
        {
            throw new ForbiddenError('Admin access is required.');
        }
    }

    // better-auth answers an unknown user id with a 404 APIError; it becomes our NotFoundError so the route maps it
    // like every other missing resource.
    #mapMissingUser(error : unknown, userID : string) : never
    {
        if(isAPIError(error) && error.statusCode === 404)
        {
            throw new NotFoundError(`No user ${ userID }.`);
        }
        throw error;
    }

    async #entryFor(user : AdminUser) : Promise<AdminUserEntry>
    {
        const usage = await this.#usage([ user.id ]);

        return { profile: toUserProfile(user), usedBytes: usage.get(user.id) ?? 0 };
    }

    async listUsers(actor : SessionUser, headers : Headers, options : ListUsersOptions = {}) : Promise<AdminUserPage>
    {
        this.#requireAdmin(actor);

        const limit = clamp(options.limit ?? DEFAULT_LIST_USERS_LIMIT, 1, MAX_LIST_USERS_LIMIT);
        const offset = Math.max(options.offset ?? 0, 0);

        const { users, total } = await this.#auth.api.listUsers({
            query: {
                limit,
                offset,
                ...options.search === undefined ? {} : {
                    searchValue: options.search,
                    searchField: options.searchField ?? 'email',
                    searchOperator: 'contains' as const,
                },
                ...options.sortBy === undefined ? {} : {
                    sortBy: options.sortBy,
                    sortDirection: options.sortDirection ?? 'asc',
                },
            },
            headers,
        });

        const usage = await this.#usage(users.map((user) => user.id));
        const entries = users.map((user) : AdminUserEntry => ({
            profile: toUserProfile(user),
            usedBytes: usage.get(user.id) ?? 0,
        }));

        return { users: entries, total, limit, offset };
    }

    // Set (or clear, with null) a user's byte quota. The write goes through the admin plugin's update-user endpoint --
    // input:false keeps quota_limit out of the sign-up payload but does not block this admin path, which maps the field
    // straight to its column.
    async setQuota(
        actor : SessionUser,
        headers : Headers,
        userID : string,
        quotaLimit : number | null
    ) : Promise<AdminUserEntry>
    {
        this.#requireAdmin(actor);

        try
        {
            const updated = await this.#auth.api.adminUpdateUser({
                body: { userId: userID, data: { quotaLimit } },
                headers,
            });

            return await this.#entryFor(updated);
        }
        catch(error)
        {
            this.#mapMissingUser(error, userID);
        }
    }

    // Ban: the plugin flips the flag, stamps reason and expiry, and deletes the user's sessions in the same call;
    // the database hooks on user.update then delete their access tokens. The self-ban guard is ours so the refusal
    // reads deterministically; the plugin would refuse it too.
    async ban(
        actor : SessionUser,
        headers : Headers,
        userID : string,
        request : BanUserRequest
    ) : Promise<AdminUserEntry>
    {
        this.#requireAdmin(actor);

        if(actor.id === userID)
        {
            throw new BadRequestError('You cannot ban yourself.');
        }

        try
        {
            const { user } = await this.#auth.api.banUser({
                body: {
                    userId: userID,
                    ...request.reason === undefined ? {} : { banReason: request.reason },
                    ...request.expiresInDays === undefined ? {} : {
                        banExpiresIn: request.expiresInDays * (MS_PER_DAY / MS_PER_SECOND),
                    },
                },
                headers,
            });

            return await this.#entryFor(user);
        }
        catch(error)
        {
            this.#mapMissingUser(error, userID);
        }
    }

    async unban(actor : SessionUser, headers : Headers, userID : string) : Promise<AdminUserEntry>
    {
        this.#requireAdmin(actor);

        try
        {
            const { user } = await this.#auth.api.unbanUser({ body: { userId: userID }, headers });

            return await this.#entryFor(user);
        }
        catch(error)
        {
            this.#mapMissingUser(error, userID);
        }
    }

    // Promote or demote. The one guard beyond RBAC: an admin cannot demote THEMSELVES -- stripping your own access
    // mid-session is only ever a mistake, and it keeps the last admin from locking the instance.
    async setRole(actor : SessionUser, headers : Headers, userID : string, role : UserRole) : Promise<AdminUserEntry>
    {
        this.#requireAdmin(actor);

        if(actor.id === userID && role !== 'admin')
        {
            throw new BadRequestError('You cannot remove your own admin role.');
        }

        try
        {
            const { user } = await this.#auth.api.setRole({ body: { userId: userID, role }, headers });

            return await this.#entryFor(user);
        }
        catch(error)
        {
            this.#mapMissingUser(error, userID);
        }
    }

    // The no-email password reset: an admin sets it, tells the user out of band, and the user changes it once
    // signed in. Existing sessions survive on purpose -- revoking them is its own explicit action.
    async setPassword(actor : SessionUser, headers : Headers, userID : string, password : string) : Promise<void>
    {
        this.#requireAdmin(actor);

        try
        {
            await this.#auth.api.setUserPassword({ body: { userId: userID, newPassword: password }, headers });
        }
        catch(error)
        {
            this.#mapMissingUser(error, userID);
        }
    }

    // "Sign out everywhere": every session row dies now; the signed session cookie can outlive them by up to the
    // cookie-cache window (60s), which is the accepted residual.
    async revokeSessions(actor : SessionUser, headers : Headers, userID : string) : Promise<void>
    {
        this.#requireAdmin(actor);

        try
        {
            await this.#auth.api.revokeUserSessions({ body: { userId: userID }, headers });
        }
        catch(error)
        {
            this.#mapMissingUser(error, userID);
        }
    }
}

//----------------------------------------------------------------------------------------------------------------------
