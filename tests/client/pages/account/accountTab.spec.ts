//----------------------------------------------------------------------------------------------------------------------
// Account Tab — storage and password composition
//
// The tab groups the storage summary and the password-change control under two headings. What this guards: both are
// present, in order, so the account-management surface never drops one.
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

//----------------------------------------------------------------------------------------------------------------------

function mountTab() : VueWrapper
{
    return mount(AccountTab, {
        global: { stubs: { AccountStorage: true, ChangePassword: true } },
    });
}

//----------------------------------------------------------------------------------------------------------------------

describe('AccountTab', () =>
{
    it('groups the controls under the Storage and Password headings in order', () =>
    {
        const wrapper = mountTab();

        expect(wrapper.findAll('h2').map((heading) => heading.text())).toEqual([ 'Storage', 'Password' ]);
    });

    it('keeps the storage summary and the password-change control', () =>
    {
        const wrapper = mountTab();

        expect(wrapper.findComponent(AccountStorage).exists()).toBe(true);
        expect(wrapper.findComponent(ChangePassword).exists()).toBe(true);
    });
});

//----------------------------------------------------------------------------------------------------------------------
