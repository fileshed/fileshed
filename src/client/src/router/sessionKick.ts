//----------------------------------------------------------------------------------------------------------------------
// Session Kick
//
// The reaction to a session dying out from under the app: any credentialed request answering 401 fires
// SESSION_LOST_EVENT (resource-access/request.ts), and this listener drops the signed-in state and bounces to
// sign-in with the interrupted destination preserved -- a banned or signed-out-everywhere user lands on the login
// page at their next interaction instead of watching every surface fail. The state clears BEFORE the navigation so
// the auth guard sees an anonymous visitor and lets /signin through. Already-anonymous fires (public pages probing
// authed endpoints) are ignored, so a wrong-password attempt or an anonymous share visit never bounces anyone.
//----------------------------------------------------------------------------------------------------------------------

import type { RouteLocationRaw } from 'vue-router';

//----------------------------------------------------------------------------------------------------------------------

export interface KickSession
{
    isAuthenticated : boolean;
    clearSession() : void;
}

export interface KickRoute
{
    fullPath : string;
    meta : Record<string, unknown>;
}

//----------------------------------------------------------------------------------------------------------------------

// Where a kicked user goes: sign-in, carrying the page they were on so a fresh sign-in returns them, and a reason
// the sign-in page turns into a "you were signed out" notice.
export function kickDestination(current : KickRoute) : RouteLocationRaw
{
    return { path: '/signin', query: { redirect: current.fullPath, reason: 'signed-out' } };
}

// Whether this fire moves the user: an anonymous session has nothing to kick, and a public page (sign-in itself,
// the setup wizard) is already where a kicked user belongs.
export function shouldRedirect(current : KickRoute, session : KickSession) : boolean
{
    return session.isAuthenticated && current.meta.public !== true;
}

//----------------------------------------------------------------------------------------------------------------------

export interface KickRouter
{
    currentRoute : { value : KickRoute };
    replace(to : RouteLocationRaw) : Promise<unknown>;
}

export function createSessionKick(router : KickRouter, getSession : () => KickSession) : () => Promise<void>
{
    return async () =>
    {
        const session = getSession();
        if(!session.isAuthenticated) { return; }

        const current = router.currentRoute.value;
        const redirect = shouldRedirect(current, session);

        session.clearSession();
        if(redirect) { await router.replace(kickDestination(current)); }
    };
}

//----------------------------------------------------------------------------------------------------------------------
