//----------------------------------------------------------------------------------------------------------------------
// Session Manager
//
// Resolves the signed-in user from request headers, with the admin plugin's `role` and our `quotaLimit` surfaced on it
// (see SessionUser). Returns null when there is no session. This is the seam every authenticated route resolves through
// -- routes call this manager rather than reaching into the auth resource directly (iDesign layering).
//----------------------------------------------------------------------------------------------------------------------

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
}

//----------------------------------------------------------------------------------------------------------------------
