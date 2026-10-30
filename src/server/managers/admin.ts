//----------------------------------------------------------------------------------------------------------------------
// Admin Manager
//
// The admin() plugin's HTTP endpoints are blocked externally (clients/http/middleware/authGate.ts), so every account
// MUTATION reaches better-auth through this manager's in-process calls, behind our own role check -- the plugin owns
// the session and token side effects a ban or a role change drags along. The caller's headers ride along on those
// calls: better-auth's own admin guard re-checks the session, and the caller is the admin we just authorized.
//
// The user listing is the exception, reading the user table directly (see listUsers).
//----------------------------------------------------------------------------------------------------------------------

import {
    type AdminUserEntry,
    type AdminUserListQuery,
    type AdminUserPageResponse,
    type AdminUserResponse,
    BadRequestError,
    type BanUserRequest,
    MS_PER_DAY,
    MS_PER_SECOND,
    NotFoundError,
    type UserProfile,
    type UserRole,
    parseUserProfile,
    toAdminUserPageResponse,
    toAdminUserResponse,
} from '@fileshed/core';

// Engines
import { assertAdmin } from '../engines/adminAccess.ts';
import { effectiveBan } from '../engines/ban.ts';
import { effectiveQuota } from '../engines/quota.ts';

// Resource Access
import type { AdminUser, AuthRA } from '../resource-access/auth/index.ts';
import type { SessionUser } from '../resource-access/auth/instance.ts';
import type { DatabaseHandle } from '../resource-access/database/database.ts';
import { NodeRA } from '../resource-access/nodes/index.ts';
import { UserRA } from '../resource-access/users/index.ts';

// Utils
import { getLogger } from '../utils/logger.ts';

//----------------------------------------------------------------------------------------------------------------------

const logger = getLogger('admin');

// One line per account change an admin makes, written after it took effect: who did what to whom.
function audit(
    admin : SessionUser,
    action : string,
    targetUserID : string,
    detail : Record<string, unknown> = {}
) : void
{
    logger.info({ action, userID: admin.id, targetUserID, ...detail }, 'Admin changed an account');
}

export interface AdminManagerDeps
{
    auth : AuthRA;
    handle : DatabaseHandle;

    // Deleting an account is not a better-auth call with a guard in front of it: the drive has to be reclaimed
    // first, and the same operation has to run later for a self-deletion falling due with no session behind it. So
    // it arrives composed, and this manager contributes only the authority to ask for it.
    deleteAccount : (userID : string) => Promise<void>;

    // The instance-wide cap an account with no limit of its own inherits, as a supplier so an admin moving the
    // setting binds the very next listing.
    defaultQuota : () => Promise<number>;
}

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
    created : Date | string;
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
        created: new Date(user.created),
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
    readonly #auth : AuthRA;
    // The listing reads the user table directly. The admin plugin's own list endpoint matches its search
    // case-sensitively on Postgres with no way to ask otherwise, so only the mutations still go through it.
    readonly #users : UserRA;
    readonly #nodes : NodeRA;
    readonly #deleteAccount : (userID : string) => Promise<void>;
    readonly #defaultQuota : () => Promise<number>;

    constructor(deps : AdminManagerDeps)
    {
        this.#auth = deps.auth;
        this.#users = new UserRA(deps.handle);
        this.#nodes = new NodeRA(deps.handle);
        this.#deleteAccount = deps.deleteAccount;
        this.#defaultQuota = deps.defaultQuota;
    }

    // One read of the default and one clock per call, never per row: the default is a settings lookup and ban standing
    // is time-sensitive, so rows resolved against two different defaults -- or two different instants -- would be a
    // listing that contradicts itself.
    async #responseFor(user : AdminUser) : Promise<AdminUserResponse>
    {
        const now = new Date();
        const [ usage, defaultQuota ] = await Promise.all([
            this.#nodes.ownedBytesByOwner([ user.id ]),
            this.#defaultQuota(),
        ]);

        return toAdminUserResponse(toEntry(user, usage.get(user.id) ?? 0, defaultQuota, now));
    }

    // The one admin capability that does NOT reach better-auth: the plugin's list endpoint matches its search
    // case-sensitively on Postgres, so the rows are fetched here instead. Authorization is unchanged -- the role check
    // above runs on the session the route already resolved -- and everything the page is assembled from is the same.
    async listUsers(admin : SessionUser, query : AdminUserListQuery) : Promise<AdminUserPageResponse>
    {
        assertAdmin(admin);

        const { users, total } = await this.#users.listUsers(query);

        const now = new Date();
        const [ usage, defaultQuota ] = await Promise.all([
            this.#nodes.ownedBytesByOwner(users.map((user) => user.id)),
            this.#defaultQuota(),
        ]);
        const entries = users.map((user) => toEntry(user, usage.get(user.id) ?? 0, defaultQuota, now));

        return toAdminUserPageResponse({ users: entries, total, limit: query.limit, offset: query.offset });
    }

    // Set (or clear, with null) a user's byte quota. The write goes through the admin plugin's update-user endpoint --
    // input:false keeps quota_limit out of the sign-up payload but does not block this admin path, which maps the field
    // straight to its column.
    async setQuota(
        admin : SessionUser,
        headers : Headers,
        userID : string,
        quotaLimit : number | null
    ) : Promise<AdminUserResponse>
    {
        assertAdmin(admin);

        const updated = await this.#auth.setQuota(headers, userID, quotaLimit);
        audit(admin, 'set-quota', userID, { quotaLimit });

        return this.#responseFor(updated);
    }

    // Ban: the plugin flips the flag, stamps reason and expiry, and deletes the user's sessions in the same call;
    // the database hooks on user.update then delete their access tokens. The self-ban guard is ours so the refusal
    // reads deterministically; the plugin would refuse it too.
    async ban(
        admin : SessionUser,
        headers : Headers,
        userID : string,
        request : BanUserRequest
    ) : Promise<AdminUserResponse>
    {
        assertAdmin(admin);

        if(admin.id === userID)
        {
            throw new BadRequestError('You cannot ban yourself.');
        }

        const user = await this.#auth.ban(headers, userID, {
            ...request.reason === undefined ? {} : { reason: request.reason },
            ...request.expiresInDays === undefined ? {} : {
                expiresInSeconds: request.expiresInDays * (MS_PER_DAY / MS_PER_SECOND),
            },
        });
        audit(admin, 'ban', userID, { expiresInDays: request.expiresInDays ?? null });

        return this.#responseFor(user);
    }

    async unban(admin : SessionUser, headers : Headers, userID : string) : Promise<AdminUserResponse>
    {
        assertAdmin(admin);

        const user = await this.#auth.unban(headers, userID);
        audit(admin, 'unban', userID);

        return this.#responseFor(user);
    }

    // Promote or demote. The one guard beyond RBAC: an admin cannot demote THEMSELVES -- stripping your own access
    // mid-session is only ever a mistake, and it keeps the last admin from locking the instance.
    async setRole(admin : SessionUser, headers : Headers, userID : string, role : UserRole) : Promise<AdminUserResponse>
    {
        assertAdmin(admin);

        if(admin.id === userID && role !== 'admin')
        {
            throw new BadRequestError('You cannot remove your own admin role.');
        }

        const user = await this.#auth.setRole(headers, userID, role);
        audit(admin, 'set-role', userID, { role });

        return this.#responseFor(user);
    }

    // The no-email password reset: an admin sets it, tells the user out of band, and the user changes it once
    // signed in. Existing sessions survive on purpose -- revoking them is its own explicit action.
    async setPassword(admin : SessionUser, headers : Headers, userID : string, password : string) : Promise<void>
    {
        assertAdmin(admin);

        await this.#auth.setPassword(headers, userID, password);
        audit(admin, 'set-password', userID);
    }

    // "Sign out everywhere": every session row dies, and the next request from any of them is refused. There is no
    // residual to accept -- the session cookie cache is off precisely so a revocation means something immediately.
    async revokeSessions(admin : SessionUser, headers : Headers, userID : string) : Promise<void>
    {
        assertAdmin(admin);

        await this.#auth.revokeUserSessions(headers, userID);
        audit(admin, 'revoke-sessions', userID);
    }

    //------------------------------------------------------------------------------------------------------------------
    // Deletion
    //------------------------------------------------------------------------------------------------------------------

    // Delete an account and everything it holds, immediately and unrecoverably. The one guard beyond RBAC: an admin
    // cannot delete THEMSELVES from the user list. Closing your own account is a decision made in your own account
    // area, not a menu item next to everyone else's; refusing it here also means the actor is always an admin other
    // than the target, so this can never take the last one.
    //
    // The existence check is our own rather than a mapped better-auth 404: deleting a user id that was never there
    // removes nothing and would otherwise answer 200 to a request that did nothing.
    async deleteUser(admin : SessionUser, userID : string) : Promise<void>
    {
        assertAdmin(admin);

        if(admin.id === userID)
        {
            throw new BadRequestError('You cannot delete your own account from the user list.');
        }

        const summaries = await this.#users.summariesByIDs([ userID ]);
        if(!summaries.has(userID)) { throw new NotFoundError(`No user ${ userID }.`); }

        await this.#deleteAccount(userID);
        audit(admin, 'delete-user', userID);
    }
}

//----------------------------------------------------------------------------------------------------------------------
