//----------------------------------------------------------------------------------------------------------------------
// Account Deletion
//
// Two halves of one thing. `deleteAccount` is the act itself, ownerless: everything one account holds, removed in the
// order that leaves nothing stranded. The manager below is the self-service road to it -- asking, waiting, and
// changing your mind.
//
// The wait is the point. A deletion the owner asks for takes effect after a window rather than at once, so a stolen
// session cannot destroy an account's data on the spot -- the person who actually owns it has that long to notice.
// What the account can still REACH, though, dies the moment it asks: shares, links, tokens, sessions. Cancelling
// brings the account back and none of that with it, which is said plainly before the request is made.
//
// Everything one account holds, removed in the order that leaves nothing stranded. The user row cascades to their
// nodes, so deleting it first would take the rows and leave the bytes behind them on disk with nothing referencing
// them and nothing to find them by -- the blob graveyard is fed by the node delete, and a row that vanishes under a
// cascade feeds it nothing. So the drive goes first, through the same subtree purge the trash sweep uses, and the
// identity goes last.
//
// Two things standing between those: the avatar, whose bytes are in the same content-addressed store but hang off the
// user row rather than a node, and the grants they handed out on other people's files, which carry no ON DELETE and
// would refuse the user delete outright.
//
// `deleteAccount` is ownerless by construction -- a user id and no actor. An admin deleting somebody and a scheduled
// self-deletion coming due are the same operation; the difference between them is who was allowed to ask.
//----------------------------------------------------------------------------------------------------------------------

// Models
import { type AccountDeletionSchedule, BadRequestError, MS_PER_DAY } from '@fileshed/core';

// Resource Access
import { type Auth, type SessionUser, deleteAccessTokensFor } from '../resource-access/auth.ts';
import type { DatabaseHandle } from '../resource-access/database/database.ts';
import type { NodeRA } from '../resource-access/nodes/node.ts';
import type { PublicLinkRA } from '../resource-access/publicLinks/index.ts';
import type { ShareRA } from '../resource-access/shares/index.ts';
import type { UserRA } from '../resource-access/users/index.ts';

// Managers
import type { SubtreePurger } from './trashPurge.ts';

//----------------------------------------------------------------------------------------------------------------------

// The one avatar-manager capability this needs: drop the reference and graveyard the bytes nothing else points at.
export interface AvatarRemover
{
    deleteAvatar(userID : string) : Promise<void>;
}

export interface AccountDeletionDeps
{
    auth : Auth;
    nodes : NodeRA;
    shares : ShareRA;
    purger : SubtreePurger;
    avatars : AvatarRemover;
}

//----------------------------------------------------------------------------------------------------------------------

export async function deleteAccount(deps : AccountDeletionDeps, userID : string) : Promise<void>
{
    // Roots only, and one at a time. Each purge is its own transaction, and the blob graveyard re-derives every
    // hash's reference count against the rows that survive -- so a file another account also holds a copy of stays
    // live, and one only this account held becomes collectable.
    for(const rootID of await deps.nodes.ownedRootIDs(userID))
    {
        // Serial by intent: each purge reads reference counts the one before it changed, and a root that sits inside
        // another of this owner's folders is cascaded away by that folder's purge rather than found again here.
        // eslint-disable-next-line no-await-in-loop -- see above
        await deps.purger.purgeSubtree(rootID);
    }

    await deps.avatars.deleteAvatar(userID);
    await deps.shares.deleteSharesCreatedBy(userID);

    // Sessions, accounts, and the row itself. This is what the admin plugin's remove-user endpoint does once it has
    // decided the caller may -- reached directly because a deletion falling due on a timer has no session to decide
    // with. The delete fires better-auth's own hooks, which is what takes the account's access tokens with it.
    const context = await deps.auth.$context;

    await context.internalAdapter.deleteUserSessions(userID);
    await context.internalAdapter.deleteUser(userID);
}

//----------------------------------------------------------------------------------------------------------------------
//----------------------------------------------------------------------------------------------------------------------
// Self-service
//----------------------------------------------------------------------------------------------------------------------

export interface AccountDeletionManagerDeps
{
    auth : Auth;
    handle : DatabaseHandle;
    users : UserRA;
    shares : ShareRA;
    links : PublicLinkRA;

    // The window, in days, read at every use rather than remembered: an admin who moves it moves every deletion
    // already waiting, because the due date is derived from the request and never stored.
    deletionDays : () => Promise<number>;
}

//----------------------------------------------------------------------------------------------------------------------

export class AccountDeletionManager
{
    readonly #auth : Auth;
    readonly #handle : DatabaseHandle;
    readonly #users : UserRA;
    readonly #shares : ShareRA;
    readonly #links : PublicLinkRA;
    readonly #deletionDays : () => Promise<number>;

    constructor(deps : AccountDeletionManagerDeps)
    {
        this.#auth = deps.auth;
        this.#handle = deps.handle;
        this.#users = deps.users;
        this.#shares = deps.shares;
        this.#links = deps.links;
        this.#deletionDays = deps.deletionDays;
    }

    // What the caller's pending deletion looks like to them, or null when they have none. The due date is computed
    // here rather than read, so it always answers the window in force right now.
    async scheduleFor(userID : string) : Promise<AccountDeletionSchedule | null>
    {
        const requestedAt = await this.#users.deletionRequestedAtOf(userID);

        return requestedAt === null ? null : this.#scheduleAt(requestedAt);
    }

    // Ask for the account to be deleted. Everything the account can reach outward dies now -- the grants it handed
    // out, the links it published, its access tokens, and every session it holds. The data waits out the window.
    //
    // The last admin is refused: an instance whose only admin deletes themselves has no way back short of the
    // database, and the refusal is not a policy an operator can want turned off.
    async request(actor : SessionUser) : Promise<AccountDeletionSchedule>
    {
        const standing = await this.#users.deletionRequestedAtOf(actor.id);
        if(standing !== null) { return this.#scheduleAt(standing); }

        if(actor.role === 'admin' && await this.#users.adminCount() <= 1)
        {
            throw new BadRequestError('You are the only admin. Promote somebody else before deleting your account.');
        }

        const requestedAt = new Date();
        await this.#users.setDeletionRequestedAt(actor.id, requestedAt);
        await this.#revokeReach(actor.id);

        return this.#scheduleAt(requestedAt);
    }

    // Change your mind. The account comes back exactly as it was -- its files, its settings, its quota -- and none of
    // what the request revoked comes back with it.
    async cancel(actor : SessionUser) : Promise<void>
    {
        await this.#users.setDeletionRequestedAt(actor.id, null);
    }

    // Everything this account reaches other people through. Ordered by how much it would cost to be wrong about it:
    // the grants and links first, because they are somebody else's access to this account's files, then the
    // credentials it holds.
    async #revokeReach(userID : string) : Promise<void>
    {
        await this.#shares.deleteSharesOnNodesOwnedBy(userID);
        await this.#shares.deleteSharesCreatedBy(userID);
        await this.#links.revokeAllOwnedBy(userID);

        await deleteAccessTokensFor(this.#handle, userID);

        const context = await this.#auth.$context;
        await context.internalAdapter.deleteUserSessions(userID);
    }

    async #scheduleAt(requestedAt : Date) : Promise<AccountDeletionSchedule>
    {
        const days = await this.#deletionDays();

        return {
            requestedAt: requestedAt.toISOString(),
            scheduledFor: new Date(requestedAt.getTime() + (days * MS_PER_DAY)).toISOString(),
        };
    }
}

//----------------------------------------------------------------------------------------------------------------------
