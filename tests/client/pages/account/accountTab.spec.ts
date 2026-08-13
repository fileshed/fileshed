//----------------------------------------------------------------------------------------------------------------------
// Account Tab — the account-management composition
//
// The tab groups the storage summary, the password-change control, the connected sign-in methods, and the
// sign-out-everywhere action under four headings. What this guards: every one is present, in order, so the surface
// never quietly drops one.
//----------------------------------------------------------------------------------------------------------------------

import { describe, expect, it, vi } from 'vitest';
import { type VueWrapper, mount } from '@vue/test-utils';

// The controls pull in @nuxt/ui's composables transitively (via the toast helper); stub that seam so importing them
// for the composition assertions never loads the Nuxt-only runtime.
vi.mock('@nuxt/ui/composables', () => ({ useToast: () => ({ add: vi.fn() }) }));

// Under test
import AccountTab from '@client/pages/account/accountTab.vue';

// Composed controls
import AccountStorage from '@client/components/account/accountStorage.vue';
import ChangePassword from '@client/components/account/changePassword.vue';
import ConnectedAccounts from '@client/components/account/connectedAccounts.vue';
import RevokeCredentials from '@client/components/account/revokeCredentials.vue';

//----------------------------------------------------------------------------------------------------------------------

function mountTab() : VueWrapper
{
    return mount(AccountTab, {
        global: {
            stubs: {
                AccountStorage: true,
                ChangePassword: true,
                ConnectedAccounts: true,
                RevokeCredentials: true,
            },
        },
    });
}

//----------------------------------------------------------------------------------------------------------------------

describe('AccountTab', () =>
{
    it('groups the controls under the Storage, Password, Connected accounts, and Sessions headings in order', () =>
    {
        const wrapper = mountTab();

        expect(wrapper.findAll('h2').map((heading) => heading.text()))
            .toEqual([ 'Storage', 'Password', 'Connected accounts', 'Sessions and tokens' ]);
    });

    it('keeps the storage summary, password change, connected accounts, and sign-out-everywhere', () =>
    {
        const wrapper = mountTab();

        expect(wrapper.findComponent(AccountStorage).exists()).toBe(true);
        expect(wrapper.findComponent(ChangePassword).exists()).toBe(true);
        expect(wrapper.findComponent(ConnectedAccounts).exists()).toBe(true);
        expect(wrapper.findComponent(RevokeCredentials).exists()).toBe(true);
    });
});

//----------------------------------------------------------------------------------------------------------------------
