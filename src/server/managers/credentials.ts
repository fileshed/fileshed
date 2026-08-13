//----------------------------------------------------------------------------------------------------------------------
// Credential Manager
//
// Sessions go last, because the caller's own session is what authorizes this call: a token delete that fails leaves
// them still signed in and able to retry. Neither half can enlist the other in a transaction -- session rows go
// through better-auth's own adapter -- so what stands in for atomicity is that each half is a single statement, a
// failure propagates instead of reporting success, and running the whole thing twice costs nothing.
//----------------------------------------------------------------------------------------------------------------------

import { isAPIError } from 'better-auth/api';

// Models
import { UnauthorizedError } from '@fileshed/core';

// Resource Access
import { type Auth, type SessionUser, deleteAccessTokensFor } from '../resource-access/auth.ts';
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

    // Every credential the account can authenticate with, gone at once: all its access tokens (both configs -- a
    // playback key downloads files just as a PAT does) and then all its sessions, the caller's included. A signed
    // session cookie can still answer for up to the cookie-cache window after its row is gone, the same residual an
    // admin revocation carries.
    async revokeAll(actor : SessionUser, headers : Headers) : Promise<void>
    {
        await deleteAccessTokensFor(this.#handle, actor.id);

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
