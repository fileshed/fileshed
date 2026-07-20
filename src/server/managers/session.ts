//----------------------------------------------------------------------------------------------------------------------
// Session Manager
//
// Resolves the signed-in user from request headers, with the admin plugin's `role` and our `quotaLimit` surfaced on it
// (see SessionUser). getUser returns null when there is no session; requireUser is the same resolution for routes that
// have no business continuing without one -- it throws UnauthorizedError instead of handing back null, so the route
// doesn't need its own null check and the 401 body comes from one place. This is the seam every authenticated route
// resolves through -- routes call this manager rather than reaching into the auth resource directly (iDesign layering).
//----------------------------------------------------------------------------------------------------------------------

// Models
import { UnauthorizedError } from '@fileshed/core';

// Resource Access
import type { Auth, SessionUser } from '../resource-access/auth.ts';

//----------------------------------------------------------------------------------------------------------------------

export class SessionManager
{
    readonly #auth : Auth;

    constructor(auth : Auth)
    {
        this.#auth = auth;
    }

    async getUser(headers : Headers) : Promise<SessionUser | null>
    {
        const session = await this.#auth.api.getSession({ headers });
        return session?.user ?? null;
    }

    async requireUser(headers : Headers) : Promise<SessionUser>
    {
        const user = await this.getUser(headers);
        if(!user) { throw new UnauthorizedError('Sign-in required.'); }

        return user;
    }
}

//----------------------------------------------------------------------------------------------------------------------
