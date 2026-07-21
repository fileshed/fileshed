//----------------------------------------------------------------------------------------------------------------------
// Navigation Guard
//----------------------------------------------------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';

import { type GuardSession, createAuthGuard, guardDecision } from '@client/router/guard.ts';

//----------------------------------------------------------------------------------------------------------------------

function session(state : { isAuthenticated ?: boolean; isAdmin ?: boolean }) : GuardSession
{
    return {
        isAuthenticated: state.isAuthenticated ?? false,
        isAdmin: state.isAdmin ?? false,
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
