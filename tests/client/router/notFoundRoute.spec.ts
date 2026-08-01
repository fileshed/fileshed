//----------------------------------------------------------------------------------------------------------------------
// Not Found Route
//
// Without a catch-all, an unmatched URL matches no record and the RouterView renders nothing -- a blank page. What
// this guards: every unmatched path lands on the 404 route, real routes are not swallowed by the catch-all, and the
// real auth guard lets the 404 through for signed-in and anonymous visitors alike. The guard runs against the meta
// the route table actually resolves, so the route and the gate are proven wired together rather than separately.
//----------------------------------------------------------------------------------------------------------------------

import { describe, expect, it, vi } from 'vitest';
import { type Router, createMemoryHistory, createRouter } from 'vue-router';

// Route resolution never renders a component, so the layouts that drag @nuxt/ui composables in stand in as trivial
// shells; the real route table is what's under test.
vi.mock('@nuxt/ui/composables', () => ({ useToast: () => ({ add: vi.fn() }) }));
vi.mock('@client/layouts/mainLayout.vue', () => ({
    default: { name: 'MainLayout', template: '<div><router-view /></div>' },
}));
vi.mock('@client/layouts/accountLayout.vue', () => ({
    default: { name: 'AccountLayout', template: '<div><router-view /></div>' },
}));

import { routes } from '@client/router/index.ts';
import { type GuardSession, guardDecision } from '@client/router/guard.ts';

//----------------------------------------------------------------------------------------------------------------------

function testRouter() : Router
{
    return createRouter({ history: createMemoryHistory(), routes });
}

function session(state : { isAuthenticated ?: boolean; isAdmin ?: boolean }) : GuardSession
{
    return {
        isAuthenticated: state.isAuthenticated ?? false,
        isAdmin: state.isAdmin ?? false,
        initialize: () => Promise.resolve(),
    };
}

//----------------------------------------------------------------------------------------------------------------------

describe('not-found route', () =>
{
    it('resolves an unmatched path to the 404 route', async () =>
    {
        const router = testRouter();

        await router.push('/admin/status');

        expect(router.currentRoute.value.name).toBe('not-found');
        expect(router.currentRoute.value.matched).toHaveLength(1);
    });

    it('catches an unmatched path at any depth', async () =>
    {
        const router = testRouter();

        await router.push('/this/does/not/exist');

        expect(router.currentRoute.value.name).toBe('not-found');
    });

    it('leaves the real routes to their own pages', async () =>
    {
        const router = testRouter();

        await router.push('/trash');
        expect(router.currentRoute.value.name).toBe('trash');

        await router.push('/account/settings');
        expect(router.currentRoute.value.name).toBe('account-settings');

        await router.push('/admin/users');
        expect(router.currentRoute.value.name).toBe('admin-users');
    });

    it('shows an anonymous visitor the 404 instead of bouncing them through sign-in', () =>
    {
        const notFound = testRouter().resolve('/admin/status');

        const decision = guardDecision(notFound, session({ isAuthenticated: false }));

        expect(decision).toBe(true);
    });

    it('shows a signed-in visitor the 404 instead of bouncing them to the drive', () =>
    {
        const notFound = testRouter().resolve('/admin/status');

        const decision = guardDecision(notFound, session({ isAuthenticated: true, isAdmin: false }));

        expect(decision).toBe(true);
    });
});

//----------------------------------------------------------------------------------------------------------------------
