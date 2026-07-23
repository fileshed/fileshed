//----------------------------------------------------------------------------------------------------------------------
// Account Area Routes
//
// The account area is its own top-level layout with child tabs, split out of the drive shell. What this guards:
// visiting /account lands on the Profile tab (never a blank shell), each tab path resolves to its own named route,
// and the tabs nest under the account layout -- not under the drive shell. A guardless memory router built from the
// real route table exercises the redirect and the nesting without dragging the auth guard or a session in.
//----------------------------------------------------------------------------------------------------------------------

import { describe, expect, it, vi } from 'vitest';
import { type Router, createMemoryHistory, createRouter } from 'vue-router';

// Importing the router drags the whole app graph in. The layouts import a public SVG the test transform can't resolve,
// and every page pulls @nuxt/ui's composables transitively -- stub those seams. Route resolution never renders a
// component, so trivial stand-ins are enough to exercise the real route table.
vi.mock('@nuxt/ui/composables', () => ({ useToast: () => ({ add: vi.fn() }) }));
vi.mock('@client/layouts/mainLayout.vue', () => ({
    default: { name: 'MainLayout', template: '<div><router-view /></div>' },
}));
vi.mock('@client/layouts/accountLayout.vue', () => ({
    default: { name: 'AccountLayout', template: '<div><router-view /></div>' },
}));

import { routes } from '@client/router/index.ts';

//----------------------------------------------------------------------------------------------------------------------

function testRouter() : Router
{
    return createRouter({ history: createMemoryHistory(), routes });
}

//----------------------------------------------------------------------------------------------------------------------

describe('account area routes', () =>
{
    it('redirects /account to the Profile tab', async () =>
    {
        const router = testRouter();

        await router.push('/account');

        expect(router.currentRoute.value.name).toBe('account-profile');
        expect(router.currentRoute.value.path).toBe('/account/profile');
    });

    it('nests each tab under the account layout, out of the drive shell', async () =>
    {
        const router = testRouter();

        await router.push('/account/settings');
        expect(router.currentRoute.value.name).toBe('account-settings');
        const settingsPaths = router.currentRoute.value.matched.map((record) => record.path);
        expect(settingsPaths).toContain('/account');
        expect(settingsPaths).not.toContain('/');

        await router.push('/account/account');
        expect(router.currentRoute.value.name).toBe('account-account');
        const accountPaths = router.currentRoute.value.matched.map((record) => record.path);
        expect(accountPaths).toContain('/account');
        expect(accountPaths).not.toContain('/');
    });

    it('resolves the Profile tab directly', async () =>
    {
        const router = testRouter();

        await router.push('/account/profile');

        expect(router.currentRoute.value.name).toBe('account-profile');
    });
});

//----------------------------------------------------------------------------------------------------------------------
