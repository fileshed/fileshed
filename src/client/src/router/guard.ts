//----------------------------------------------------------------------------------------------------------------------
// Navigation Guard
//
// Session restoration is awaited before any decision, so a reload carrying a valid cookie is never bounced to /signin.
//
// Two metas, easily confused: `public` marks the anonymous-only auth pages, which a signed-in visitor is bounced off;
// `unguarded` marks a route belonging to everyone (the 404), which nobody is redirected away from.
//
// An account that has asked to be deleted is sent from every route but the one marked `closing` to the closing page.
// This is a courtesy rather than a control, since the server refuses that account everywhere else anyway: it lets them
// meet a page saying when the account goes and offering to call it off, instead of a drive that answers 403 to
// everything.
//----------------------------------------------------------------------------------------------------------------------

import type { RouteLocationRaw } from 'vue-router';

//----------------------------------------------------------------------------------------------------------------------

export interface GuardSession
{
    initialize() : Promise<void>;
    isAuthenticated : boolean;
    isAdmin : boolean;
    isClosing : boolean;
}

// Only the route fields the decision reads. A real RouteLocationNormalized satisfies this structurally, so the guard
// takes the router's own `to` unchanged while staying trivial to construct in a test.
export interface GuardRoute
{
    fullPath : string;
    meta : Record<string, unknown>;
}

export type AuthGuard = (to : GuardRoute) => Promise<true | RouteLocationRaw>;

//----------------------------------------------------------------------------------------------------------------------

export function guardDecision(to : GuardRoute, session : GuardSession) : true | RouteLocationRaw
{
    if(to.meta.unguarded === true)
    {
        return true;
    }

    if(to.meta.public === true)
    {
        return session.isAuthenticated ? { path: '/' } : true;
    }

    if(!session.isAuthenticated)
    {
        return { path: '/signin', query: { redirect: to.fullPath } };
    }

    if(session.isClosing)
    {
        return to.meta.closing === true ? true : { path: '/closing' };
    }

    if(to.meta.admin === true && !session.isAdmin)
    {
        return { path: '/' };
    }

    return true;
}

//----------------------------------------------------------------------------------------------------------------------

export function createAuthGuard(getSession : () => GuardSession) : AuthGuard
{
    return async (to) =>
    {
        const session = getSession();
        await session.initialize();

        return guardDecision(to, session);
    };
}

//----------------------------------------------------------------------------------------------------------------------
