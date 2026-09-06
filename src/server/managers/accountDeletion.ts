//----------------------------------------------------------------------------------------------------------------------
// Account Deletion
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
// Ownerless by construction -- it takes a user id and no actor. An admin deleting somebody and, later, a scheduled
// self-deletion coming due are the same operation, and the difference between them is who was allowed to ask.
//----------------------------------------------------------------------------------------------------------------------

// Resource Access
import type { Auth } from '../resource-access/auth.ts';
import type { NodeRA } from '../resource-access/nodes/node.ts';
import type { ShareRA } from '../resource-access/shares/index.ts';

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
