//----------------------------------------------------------------------------------------------------------------------
// Admin Manager
//
// The business layer behind the gated admin surface. The admin() plugin's HTTP endpoints are blocked externally
// (app.ts), so every account MUTATION reaches better-auth through this manager's in-process auth.api.* calls, behind
// our own role check -- the plugin owns the session and token side effects a ban or a role change drags along. The
// caller's headers ride along on those calls: better-auth's own admin guard re-checks the session, and the caller is
// the admin we just authorized -- the gated capability executing through the one sanctioned surface.
//
// The user listing is the exception, reading the user table directly (see listUsers).
//
// Authorization lives here rather than in the regulation engine: "is this account an admin?" is plain RBAC on the
// account role, not the cross-record data legality the regulation engine models -- adding a judge there would overload
// its purpose. The check is a single condition, enforced once, at the manager boundary.
//----------------------------------------------------------------------------------------------------------------------

import { isAPIError } from 'better-auth/api';

import {
    type AdminUserEntry,
    type AdminUserPage,
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

// Engines
import { effectiveBan } from '../engines/ban.ts';
import { effectiveQuota } from '../engines/quota.ts';

// Resource Access
import type { Auth, SessionUser } from '../resource-access/auth.ts';
import type { UserRA } from '../resource-access/users/index.ts';

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

// The bytes charged to each of a set of owners; owners absent from the map charge nothing. bootApp backs this with
// the node store's grouped aggregate; auth-only compositions (no node store) answer an empty map.
export type UsageResolver = (ownerIDs : string[]) => Promise<Map<string, number>>;

export interface AdminManagerDeps
{
    auth : Auth;

    // The listing reads the user table directly. The admin plugin's own list endpoint matches its search
    // case-sensitively on Postgres with no way to ask otherwise, so only the mutations still go through it.
    users : UserRA;

    usage : UsageResolver;

    // The instance-wide cap an account with no limit of its own inherits, as a supplier so an admin moving the
    // setting binds the very next listing.
    defaultQuota : () => Promise<number>;
}

// The admin plugin types a mutation's result as UserWithRole, which does not statically carry app-level
// additionalFields; quota_limit is present at runtime (it is a real column), so the type is widened to admit it.
type AdminUser = Awaited<ReturnType<Auth['api']['banUser']>>['user'] & { quotaLimit ?: number | null };

// What a profile is built from, satisfied by both the plugin's user and the listing's own row -- the two paths a
// user reaches this manager by.
interface ProfileSource
{
    id : string;
    email : string;
    name : string;
    role ?: string | null;
    quotaLimit ?: number | null;
    banned ?: boolean | null;
    banReason ?: string | null;
    banExpires ?: Date | string | null;
    createdAt : Date | string;
}

// better-auth's user carries plugin fields the codec narrows and validates; the ban trio is normalized here because
// the plugin leaves them null/undefined on accounts never banned, and banExpires crosses some adapters as a string.
// Standing then goes through the ban engine: the row keeps a stale banned flag after a dated ban lapses (better-auth
// only clears it on the user's next sign-in), and a lapsed ban must read as a clean record. The clock is passed in,
// never read here, so every row in one listing is judged against the same instant.
function toUserProfile(user : ProfileSource, now : Date) : UserProfile
{
    const ban = effectiveBan({
        banned: user.banned === true,
        banReason: user.banReason ?? null,
        banExpires: user.banExpires ? new Date(user.banExpires) : null,
    }, now);

    return parseUserProfile({
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        quotaLimit: user.quotaLimit ?? null,
        banned: ban.banned,
        banReason: ban.banReason,
        banExpires: ban.banExpires,
        createdAt: new Date(user.createdAt),
    });
}

function toEntry(user : ProfileSource, usedBytes : number, defaultQuota : number, now : Date) : AdminUserEntry
{
    const profile = toUserProfile(user, now);

    return { profile, quotaEffective: effectiveQuota(profile.quotaLimit, defaultQuota), usedBytes };
}

//----------------------------------------------------------------------------------------------------------------------

export class AdminManager
{
    readonly #auth : Auth;
    readonly #users : UserRA;
    readonly #usage : UsageResolver;
    readonly #defaultQuota : () => Promise<number>;

    constructor(deps : AdminManagerDeps)
    {
        this.#auth = deps.auth;
        this.#users = deps.users;
        this.#usage = deps.usage;
        this.#defaultQuota = deps.defaultQuota;
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

    // One read of the default and one clock per call, never per row: the default is a settings lookup and ban standing
    // is time-sensitive, so rows resolved against two different defaults -- or two different instants -- would be a
    // listing that contradicts itself.
    async #entryFor(user : AdminUser) : Promise<AdminUserEntry>
    {
        const now = new Date();
        const [ usage, defaultQuota ] = await Promise.all([ this.#usage([ user.id ]), this.#defaultQuota() ]);

        return toEntry(user, usage.get(user.id) ?? 0, defaultQuota, now);
    }

    // The one admin capability that does NOT reach better-auth: the plugin's list endpoint matches its search
    // case-sensitively on Postgres, so the rows are fetched here instead. Authorization is unchanged -- the role check
    // above runs on the session the route already resolved -- and everything the page is assembled from is the same.
    async listUsers(actor : SessionUser, options : ListUsersOptions = {}) : Promise<AdminUserPage>
    {
        this.#requireAdmin(actor);

        const limit = clamp(options.limit ?? DEFAULT_LIST_USERS_LIMIT, 1, MAX_LIST_USERS_LIMIT);
        const offset = Math.max(options.offset ?? 0, 0);

        const { users, total } = await this.#users.listUsers({
            limit,
            offset,
            ...options.search === undefined ? {} : { search: options.search },
            searchField: options.searchField ?? 'email',
            ...options.sortBy === undefined ? {} : { sortBy: options.sortBy },
            sortDirection: options.sortDirection ?? 'asc',
        });

        const now = new Date();
        const [ usage, defaultQuota ] = await Promise.all([
            this.#usage(users.map((user) => user.id)),
            this.#defaultQuota(),
        ]);
        const entries = users.map((user) => toEntry(user, usage.get(user.id) ?? 0, defaultQuota, now));

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

    // "Sign out everywhere": every session row dies, and the next request from any of them is refused. There is no
    // residual to accept -- the session cookie cache is off precisely so a revocation means something immediately.
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
