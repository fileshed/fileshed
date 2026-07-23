//----------------------------------------------------------------------------------------------------------------------
// User Manager
//
// The app-side user lookup surface. lookupByEmail resolves an EXACT email to a UserSummary for the share dialog's grant
// flow, so a granter sees who they are about to grant before granting -- typo safety. Exact match only: the endpoint
// never enumerates accounts by prefix or substring, a tradeoff the product owner accepts for self-hosted deployments.
// An unknown email is a NotFoundError, mapped to a 404 by onError.
//----------------------------------------------------------------------------------------------------------------------

// Models
import { NotFoundError, type UserSummary } from '@fileshed/core';

// Resource Access
import type { UserRA } from '../resource-access/users/index.ts';

//----------------------------------------------------------------------------------------------------------------------

export class UserManager
{
    readonly #users : UserRA;

    constructor(users : UserRA)
    {
        this.#users = users;
    }

    async lookupByEmail(email : string) : Promise<UserSummary>
    {
        const summary = await this.#users.findSummaryByEmail(email);
        if(summary === undefined) { throw new NotFoundError('No user with that email.'); }

        return summary;
    }
}

//----------------------------------------------------------------------------------------------------------------------
