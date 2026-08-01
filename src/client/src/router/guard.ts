//----------------------------------------------------------------------------------------------------------------------
// Navigation Guard
//
// The global gate. Unauthenticated visitors are sent to /signin with their intended destination preserved for the
// post-sign-in redirect; already-authenticated visitors bounce off the public auth pages to the drive; /admin
// additionally requires the admin role. Session restoration is awaited first, so a page reload carrying a valid cookie
// is resolved before the decision -- a live session is never bounced to /signin.
//
// Two metas, easily confused: `public` marks the anonymous-only auth pages, which a signed-in visitor is bounced off
// of; `unguarded` marks a route belonging to everyone -- the 404 -- which nobody is redirected away from in either
// direction.
//----------------------------------------------------------------------------------------------------------------------

import type { RouteLocationRaw } from 'vue-router';

//----------------------------------------------------------------------------------------------------------------------

export interface GuardSession
{
    initialize() : Promise<void>;
    isAuthenticated : boolean;
    isAdmin : boolean;
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
