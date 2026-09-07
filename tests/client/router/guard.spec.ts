//----------------------------------------------------------------------------------------------------------------------
// Navigation Guard
//----------------------------------------------------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';

import { type GuardSession, createAuthGuard, guardDecision } from '@client/router/guard.ts';

//----------------------------------------------------------------------------------------------------------------------

function session(state : { isAuthenticated ?: boolean; isAdmin ?: boolean; isClosing ?: boolean }) : GuardSession
{
    return {
        isAuthenticated: state.isAuthenticated ?? false,
        isAdmin: state.isAdmin ?? false,
        isClosing: state.isClosing ?? false,
        initialize: () => Promise.resolve(),
    };
}

//----------------------------------------------------------------------------------------------------------------------

describe('guardDecision', () =>
{
    it('sends an unauthenticated visitor to /signin, preserving the intended destination', () =>
    {
        const decision = guardDecision({ fullPath: '/trash', meta: {} }, session({ isAuthenticated: false }));

        expect(decision).toEqual({ path: '/signin', query: { redirect: '/trash' } });
    });

    it('lets an authenticated visitor through to a protected route', () =>
    {
        const decision = guardDecision({ fullPath: '/', meta: {} }, session({ isAuthenticated: true }));

        expect(decision).toBe(true);
    });

    it('lets an anonymous visitor reach a public auth page', () =>
    {
        const decision = guardDecision(
            { fullPath: '/signin', meta: { public: true } },
            session({ isAuthenticated: false })
        );

        expect(decision).toBe(true);
    });

    it('bounces an already-authenticated visitor off the public auth pages to the drive', () =>
    {
        const decision = guardDecision(
            { fullPath: '/signin', meta: { public: true } },
            session({ isAuthenticated: true })
        );

        expect(decision).toEqual({ path: '/' });
    });

    it('redirects a non-admin away from an admin route to the drive', () =>
    {
        const decision = guardDecision(
            { fullPath: '/admin', meta: { admin: true } },
            session({ isAuthenticated: true, isAdmin: false })
        );

        expect(decision).toEqual({ path: '/' });
    });

    it('lets an admin reach an admin route', () =>
    {
        const decision = guardDecision(
            { fullPath: '/admin', meta: { admin: true } },
            session({ isAuthenticated: true, isAdmin: true })
        );

        expect(decision).toBe(true);
    });

    // An account on its way out is refused everywhere by the server, so sending it to the drive would only produce a
    // page of 403s where a date and a cancel button belong.
    it('sends an account scheduled for deletion to the interstitial', () =>
    {
        const decision = guardDecision(
            { fullPath: '/trash', meta: {} },
            session({ isAuthenticated: true, isClosing: true })
        );

        expect(decision).toEqual({ path: '/closing' });
    });

    it('lets it reach the interstitial itself', () =>
    {
        const decision = guardDecision(
            { fullPath: '/closing', meta: { closing: true } },
            session({ isAuthenticated: true, isClosing: true })
        );

        expect(decision).toBe(true);
    });

    // Admin is beside the point once the account is going: the interstitial comes first either way.
    it('sends a closing admin to the interstitial rather than the admin area', () =>
    {
        const decision = guardDecision(
            { fullPath: '/admin', meta: { admin: true } },
            session({ isAuthenticated: true, isAdmin: true, isClosing: true })
        );

        expect(decision).toEqual({ path: '/closing' });
    });

    // The interstitial is for an account that is going, not a signed-out visitor who typed the URL.
    it('sends an anonymous visitor at the interstitial to sign in', () =>
    {
        const decision = guardDecision(
            { fullPath: '/closing', meta: { closing: true } },
            session({ isAuthenticated: false })
        );

        expect(decision).toEqual({ path: '/signin', query: { redirect: '/closing' } });
    });
});

//----------------------------------------------------------------------------------------------------------------------

describe('createAuthGuard', () =>
{
    it('awaits session restoration before deciding', async () =>
    {
        const events : string[] = [];
        const restoring : GuardSession = {
            isAuthenticated: false,
            isAdmin: false,
            isClosing: false,
            initialize: async () => { events.push('init'); },
        };
        const guard = createAuthGuard(() => restoring);

        const decision = await guard({ fullPath: '/trash', meta: {} });
        events.push('decide');

        expect(events).toEqual([ 'init', 'decide' ]);
        expect(decision).toEqual({ path: '/signin', query: { redirect: '/trash' } });
    });

    it('honours the session as restoration leaves it', async () =>
    {
        const guard = createAuthGuard(() => session({ isAuthenticated: true }));

        const decision = await guard({ fullPath: '/', meta: {} });

        expect(decision).toBe(true);
    });
});

//----------------------------------------------------------------------------------------------------------------------
