//----------------------------------------------------------------------------------------------------------------------
// Credential Manager
//
// Sessions go last, because the caller's own session is what authorizes this call: a step that fails before them
// leaves the caller still signed in and able to retry. The steps cannot share a transaction -- session rows go
// through better-auth's own adapter -- so what stands in for atomicity is that each is a single statement, a
// failure propagates instead of reporting success, and running the whole thing twice costs nothing.
//----------------------------------------------------------------------------------------------------------------------

// Resource Access
import type { AuthRA } from '../resource-access/auth/index.ts';
import type { SessionUser } from '../resource-access/auth/instance.ts';

//----------------------------------------------------------------------------------------------------------------------

export class CredentialManager
{
    readonly #auth : AuthRA;

    constructor(auth : AuthRA)
    {
        this.#auth = auth;
    }

    // Every way into the account that does not require the password, gone at once: all its access tokens (both
    // configs -- a playback key downloads files just as a PAT does), every pending one-time action, and then all its
    // sessions, the caller's included.
    //
    // The pending actions matter as much as the tokens. A password-reset link already in a mailbox is a full
    // takeover that no amount of session revocation touches, and someone reaching for this button is trying to stop
    // exactly that. Linked OAuth accounts are deliberately left: unlinking would lock out an account whose only
    // credential is the provider.
    async revokeAll(user : SessionUser, headers : Headers) : Promise<void>
    {
        await this.#auth.deleteAccessTokens(user.id);
        await this.#auth.deletePendingAccountActions(user.id);

        await this.#auth.revokeOwnSessions(headers);
    }
}

//----------------------------------------------------------------------------------------------------------------------
