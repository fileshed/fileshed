//----------------------------------------------------------------------------------------------------------------------
// Account Deletion
//
// `deleteAccount` is the act itself: everything one account holds, removed in the order that leaves nothing stranded.
// The manager below is the self-service side of it: asking, waiting, and changing your mind.
//
// The wait is the point. A deletion the owner asks for takes effect after a window rather than at once, so a stolen
// session cannot destroy an account's data on the spot -- the person who actually owns it has that long to notice.
// What the account can still REACH, though, dies the moment it asks: shares, links, tokens, sessions. Cancelling
// brings the account back and none of that with it, which is said plainly before the request is made.
//
// The user row cascades to their nodes, so deleting it first would take the rows and leave the bytes behind them on
// disk with nothing referencing them and nothing to find them by -- the blob graveyard is fed by the node delete, and a
// row that vanishes under a cascade feeds it nothing. So the drive goes first, through the same subtree purge the trash
// sweep uses, and the identity goes last.
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
import type { AuthRA } from '../resource-access/auth/index.ts';
import type { SessionUser } from '../resource-access/auth/instance.ts';
import type { DatabaseHandle } from '../resource-access/database/database.ts';
import type { NodeRA } from '../resource-access/nodes/index.ts';
import { PublicLinkRA } from '../resource-access/publicLinks/index.ts';
import { ShareRA } from '../resource-access/shares/index.ts';
import { UserRA } from '../resource-access/users/index.ts';

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
    auth : AuthRA;
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

    // Sessions, accounts, and the row itself: what the admin plugin's remove-user endpoint does once it has decided
    // the caller may, with no session deciding, because a deletion falling due on a timer has none.
    await deps.auth.deleteUserSessions(userID);
    await deps.auth.deleteUser(userID);
}

//----------------------------------------------------------------------------------------------------------------------
// Self-service
//----------------------------------------------------------------------------------------------------------------------

export interface AccountDeletionManagerDeps
{
    auth : AuthRA;
    handle : DatabaseHandle;

    // The window, in days, read at every use rather than remembered: an admin who moves it moves every deletion
    // already waiting, because the due date is derived from the request and never stored.
    deletionDays : () => Promise<number>;
}

//----------------------------------------------------------------------------------------------------------------------

export class AccountDeletionManager
{
    readonly #auth : AuthRA;
    readonly #users : UserRA;
    readonly #shares : ShareRA;
    readonly #links : PublicLinkRA;
    readonly #deletionDays : () => Promise<number>;

    constructor(deps : AccountDeletionManagerDeps)
    {
        this.#auth = deps.auth;
        this.#users = new UserRA(deps.handle);
        this.#shares = new ShareRA(deps.handle);
        this.#links = new PublicLinkRA(deps.handle);
        this.#deletionDays = deps.deletionDays;
    }

    // What the caller's pending deletion looks like to them, or null when they have none. The due date is computed
    // here rather than read, so it always answers the window in force right now.
    async scheduleFor(userID : string) : Promise<AccountDeletionSchedule | null>
    {
        const requested = await this.#users.deletionRequestedAtOf(userID);

        return requested === null ? null : this.#scheduleAt(requested);
    }

    // Ask for the account to be deleted. Everything the account can reach outward dies now -- the grants it handed
    // out, the links it published, its access tokens, and every session it holds. The data waits out the window.
    //
    // The last admin is refused: an instance whose only admin deletes themselves has no way back short of the
    // database, and the refusal is not a policy an operator can want turned off.
    async request(user : SessionUser) : Promise<AccountDeletionSchedule>
    {
        const standing = await this.#users.deletionRequestedAtOf(user.id);
        if(standing !== null) { return this.#scheduleAt(standing); }

        if(user.role === 'admin' && await this.#users.adminCount() <= 1)
        {
            throw new BadRequestError('You are the only admin. Promote somebody else before deleting your account.');
        }

        const requested = new Date();
        await this.#users.setDeletionRequested(user.id, requested);
        await this.#revokeReach(user.id);

        return this.#scheduleAt(requested);
    }

    // Change your mind. The account comes back exactly as it was -- its files, its settings, its quota -- and none of
    // what the request revoked comes back with it.
    async cancel(user : SessionUser) : Promise<void>
    {
        await this.#users.setDeletionRequested(user.id, null);
    }

    // Everything this account reaches other people through. Ordered by how much it would cost to be wrong about it:
    // the grants and links first, because they are somebody else's access to this account's files, then the
    // credentials it holds.
    async #revokeReach(userID : string) : Promise<void>
    {
        await this.#shares.deleteSharesOnNodesOwnedBy(userID);
        await this.#shares.deleteSharesCreatedBy(userID);
        await this.#links.revokeAllOwnedBy(userID);

        await this.#auth.deleteAccessTokens(userID);
        await this.#auth.deleteUserSessions(userID);
    }

    async #scheduleAt(requested : Date) : Promise<AccountDeletionSchedule>
    {
        const days = await this.#deletionDays();

        return {
            requested: requested.toISOString(),
            scheduledFor: new Date(requested.getTime() + (days * MS_PER_DAY)).toISOString(),
        };
    }
}

//----------------------------------------------------------------------------------------------------------------------
