//----------------------------------------------------------------------------------------------------------------------
// Session Kick — the reaction to a session dying mid-use
//
// The contract: when a 401 announces the session is gone, a signed-in user is dropped to anonymous and bounced to
// sign-in with their interrupted destination and a signed-out reason; the state clears before the navigation so
// the auth guard admits them. An already-anonymous fire does nothing (a wrong password or an anonymous visitor's
// probe must never bounce anyone), and a fire on a public page clears state without navigating -- the user is
// already where a kicked visitor belongs.
//----------------------------------------------------------------------------------------------------------------------

import { describe, expect, it, vi } from 'vitest';

// Under test
import { type KickRoute, type KickSession, createSessionKick, kickDestination } from '@client/router/sessionKick.ts';

//----------------------------------------------------------------------------------------------------------------------

function route(fullPath : string, meta : Record<string, unknown> = {}) : KickRoute
{
    return { fullPath, meta };
}

function fakeSession(authenticated : boolean) : KickSession & { cleared : boolean }
{
    const session = {
        isAuthenticated: authenticated,
        cleared: false,
        clearSession()
        {
            session.isAuthenticated = false;
            session.cleared = true;
        },
    };

    return session;
}

function fakeRouter(current : KickRoute) : { currentRoute : { value : KickRoute }; replace : ReturnType<typeof vi.fn> }
{
    return { currentRoute: { value: current }, replace: vi.fn().mockResolvedValue(undefined) };
}

//----------------------------------------------------------------------------------------------------------------------

describe('createSessionKick', () =>
{
    it('drops a signed-in user to sign-in, preserving where they were and why', async () =>
    {
        const session = fakeSession(true);
        const router = fakeRouter(route('/folder/abc?sort=name'));

        await createSessionKick(router, () => session)();

        expect(session.cleared).toBe(true);
        expect(router.replace).toHaveBeenCalledWith({
            path: '/signin',
            query: { redirect: '/folder/abc?sort=name', reason: 'signed-out' },
        });
    });

    it('does nothing for an anonymous session -- failed sign-ins and public probes never bounce', async () =>
    {
        const session = fakeSession(false);
        const router = fakeRouter(route('/signin'));

        await createSessionKick(router, () => session)();

        expect(session.cleared).toBe(false);
        expect(router.replace).not.toHaveBeenCalled();
    });

    it('clears state without navigating when already on a public page', async () =>
    {
        const session = fakeSession(true);
        const router = fakeRouter(route('/setup', { public: true }));

        await createSessionKick(router, () => session)();

        expect(session.cleared).toBe(true);
        expect(router.replace).not.toHaveBeenCalled();
    });
});

describe('kickDestination', () =>
{
    it('targets sign-in with the interrupted path and the signed-out reason', () =>
    {
        expect(kickDestination(route('/trash'))).toEqual({
            path: '/signin',
            query: { redirect: '/trash', reason: 'signed-out' },
        });
    });
});

//----------------------------------------------------------------------------------------------------------------------
