//----------------------------------------------------------------------------------------------------------------------
// Account Deletion Manager, for specs that only need /api/me mounted
//
// The me routes carry the two self-service deletion surfaces, so every composition that mounts them needs the
// manager behind them even when the spec is about avatars or shares. This is the real manager on the spec's own
// database -- a stub would let those compositions drift from the one bootApp wires.
//----------------------------------------------------------------------------------------------------------------------

// Models
import { DEFAULT_ACCOUNT_DELETION_DAYS } from '@fileshed/core';

// Managers
import { AccountDeletionManager } from '@server/managers/accountDeletion.ts';

// Resource Access
import type { Auth } from '@server/resource-access/auth.ts';
import type { DatabaseHandle } from '@server/resource-access/database/database.ts';
import { PublicLinkRA } from '@server/resource-access/publicLinks/index.ts';
import { ShareRA } from '@server/resource-access/shares/index.ts';
import { UserRA } from '@server/resource-access/users/index.ts';

//----------------------------------------------------------------------------------------------------------------------

export function accountDeletionsFor(
    auth : Auth,
    handle : DatabaseHandle,
    days = DEFAULT_ACCOUNT_DELETION_DAYS
) : AccountDeletionManager
{
    return new AccountDeletionManager({
        auth,
        handle,
        users: new UserRA(handle),
        shares: new ShareRA(handle),
        links: new PublicLinkRA(handle),
        deletionDays: async () => days,
    });
}

//----------------------------------------------------------------------------------------------------------------------
