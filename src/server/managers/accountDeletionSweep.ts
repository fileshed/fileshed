//----------------------------------------------------------------------------------------------------------------------
// Account Deletion Sweep
//
// The scheduled run that carries out the deletions their owners asked for once the window has run out. It reads the
// window at the start of every run and derives the cutoff from it, so an admin who lengthens the window spares an
// account that had not yet come due -- the due date lives in the setting and the request instant, never in a stored
// date that would go on saying what the old window said.
//
// Each account goes through the same deleteAccount an admin's delete does. One failure is logged and counted, never
// rethrown: the account is left exactly as it was, request and all, and the next run tries again.
//----------------------------------------------------------------------------------------------------------------------

// Models
import type { AccountDeletionRunSummary } from '@fileshed/core';

// Resource Access
import type { UserRA } from '../resource-access/users/index.ts';

// Utils
import { getLogger } from '../utils/logger.ts';

//----------------------------------------------------------------------------------------------------------------------

const logger = getLogger('account-deletion');

export interface AccountDeletionSweepDeps
{
    users : UserRA;

    // The account deletion itself, already bound to everything it reclaims.
    deleteAccount : (userID : string) => Promise<void>;

    // Read at the start of each run, so an admin changing the window needs no restart.
    windowMs : () => Promise<number>;
}

//----------------------------------------------------------------------------------------------------------------------

export async function runAccountDeletionOnce(deps : AccountDeletionSweepDeps) : Promise<AccountDeletionRunSummary>
{
    const cutoff = new Date(Date.now() - await deps.windowMs());
    const due = await deps.users.deletionDueBefore(cutoff);

    // Serial, unlike the trash sweep's roots: each deletion purges subtrees and re-derives blob reference counts, and
    // two accounts holding the same content must not judge that question at the same moment.
    const outcomes : string[] = [];
    for(const userID of due)
    {
        try
        {
            // eslint-disable-next-line no-await-in-loop -- serial by intent; see above
            await deps.deleteAccount(userID);
            outcomes.push('deleted');
        }
        catch(error)
        {
            logger.error({ err: error, userID }, 'account deletion failed');
            outcomes.push('failed');
        }
    }

    const deleted = outcomes.filter((outcome) => outcome === 'deleted').length;
    const failed = outcomes.filter((outcome) => outcome === 'failed').length;

    const level = failed > 0 ? 'warn' : (due.length > 0 ? 'info' : 'debug');
    logger[level]({ candidates: due.length, deleted, failed }, 'account deletion sweep complete');

    return { candidates: due.length, deleted, failed };
}

//----------------------------------------------------------------------------------------------------------------------
