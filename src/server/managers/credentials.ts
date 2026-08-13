//----------------------------------------------------------------------------------------------------------------------
// Credential Manager
//
// Sessions go last, because the caller's own session is what authorizes this call: a step that fails before them
// leaves the caller still signed in and able to retry. The steps cannot share a transaction -- session rows go
// through better-auth's own adapter -- so what stands in for atomicity is that each is a single statement, a
// failure propagates instead of reporting success, and running the whole thing twice costs nothing.
//----------------------------------------------------------------------------------------------------------------------

import { isAPIError } from 'better-auth/api';

// Models
import { UnauthorizedError } from '@fileshed/core';

// Resource Access
import {
    type Auth,
    type SessionUser,
    deleteAccessTokensFor,
    deletePendingAccountActionsFor,
} from '../resource-access/auth.ts';
import type { DatabaseHandle } from '../resource-access/database/database.ts';

//----------------------------------------------------------------------------------------------------------------------

export interface CredentialManagerDeps
{
    auth : Auth;
    handle : DatabaseHandle;
}

export class CredentialManager
{
    readonly #auth : Auth;
    readonly #handle : DatabaseHandle;

    constructor(deps : CredentialManagerDeps)
    {
        this.#auth = deps.auth;
        this.#handle = deps.handle;
    }

    // Every way into the account that does not require the password, gone at once: all its access tokens (both
    // configs -- a playback key downloads files just as a PAT does), every pending one-time action, and then all its
    // sessions, the caller's included.
    //
    // The pending actions matter as much as the tokens. A password-reset link already in a mailbox is a full
    // takeover that no amount of session revocation touches, and someone reaching for this button is trying to stop
    // exactly that. Linked OAuth accounts are deliberately left: unlinking would lock out an account whose only
    // credential is the provider.
    async revokeAll(actor : SessionUser, headers : Headers) : Promise<void>
    {
        await deleteAccessTokensFor(this.#handle, actor.id);
        await deletePendingAccountActionsFor(this.#handle, actor.id);

        try
        {
            await this.#auth.api.revokeSessions({ headers });
        }
        catch(error)
        {
            // The session died between the route's check and this call. better-auth answers with its own APIError,
            // which nothing downstream maps, so it would surface as a 500 where 401 is the honest answer. Only its
            // 401 means that: the same class carries a failed session delete, and calling THAT 401 would tell the
            // caller they are signed out everywhere while every session they asked to end is still alive.
            if(isAPIError(error) && error.statusCode === 401)
            {
                throw new UnauthorizedError('Sign-in required.');
            }

            throw error;
        }
    }
}

//----------------------------------------------------------------------------------------------------------------------
