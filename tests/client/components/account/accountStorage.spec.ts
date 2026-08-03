//----------------------------------------------------------------------------------------------------------------------
// Account Storage — the account-page usage summary
//
// The real session store runs; nothing touches the wire. The label always carries a denominator -- "Unlimited" when
// nothing caps the account -- and the progress bar appears only when a cap exists to measure against. The
// denominator is the effective cap, so an account inheriting the instance default reads as capped, not unlimited.
//----------------------------------------------------------------------------------------------------------------------

import { beforeEach, describe, expect, it } from 'vitest';
import { type VueWrapper, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';

// Stores
import { useSessionStore } from '@client/stores/session.ts';

// Support
import { meFixture } from '../../support.ts';

// Under test
import AccountStorage from '@client/components/account/accountStorage.vue';

//----------------------------------------------------------------------------------------------------------------------

const UProgressStub = {
    name: 'UProgress',
    props: [ 'modelValue', 'max' ],
    template: '<div class="progress" :data-value="modelValue" :data-max="max" />',
};

const UTooltipStub = {
    name: 'UTooltip',
    props: [ 'text', 'disabled' ],
    template: '<div class="tooltip" :data-text="text" :data-disabled="String(disabled)"><slot /></div>',
};

function mountStorage() : VueWrapper
{
    return mount(AccountStorage, { global: { stubs: { UProgress: UProgressStub, UTooltip: UTooltipStub } } });
}

//----------------------------------------------------------------------------------------------------------------------

describe('AccountStorage', () =>
{
    beforeEach(() =>
    {
        setActivePinia(createPinia());
    });

    it('shows usage over "Unlimited" with no progress bar when nothing caps the account', () =>
    {
        const session = useSessionStore();
        session.me = meFixture({ quota: { used: 218_800, effective: null, limit: null } });

        const wrapper = mountStorage();

        expect(wrapper.text()).toContain('218.8 kB used / Unlimited');
        expect(wrapper.find('.progress').exists()).toBe(false);
    });

    it('shows usage over the limit with a progress bar when a quota is set', () =>
    {
        const session = useSessionStore();
        session.me = meFixture({ quota: { used: 1_000_000_000, effective: 5_000_000_000, limit: 5_000_000_000 } });

        const wrapper = mountStorage();

        expect(wrapper.text()).toContain('1 GB used / 5 GB');

        const progress = wrapper.get('.progress');
        expect(progress.attributes('data-value')).toBe('1000000000');
        expect(progress.attributes('data-max')).toBe('5000000000');
    });

    it('shows the inherited instance cap for an account with no limit of its own', () =>
    {
        const session = useSessionStore();
        session.me = meFixture({ quota: { used: 1_000_000_000, effective: 5_000_000_000, limit: null } });

        const wrapper = mountStorage();

        expect(wrapper.text()).toContain('1 GB used / 5 GB');
        expect(wrapper.get('.progress').attributes('data-max')).toBe('5000000000');
    });

    it('carries the consumed percentage as the hover tooltip when capped', () =>
    {
        const session = useSessionStore();
        session.me = meFixture({ quota: { used: 1_000_000_000, effective: 5_000_000_000, limit: 5_000_000_000 } });

        const wrapper = mountStorage();

        expect(wrapper.find('.tooltip').attributes('data-text')).toBe('20% of your storage used');
    });

    it('renders nothing before the profile loads', () =>
    {
        const wrapper = mountStorage();

        expect(wrapper.text()).toBe('');
    });
});

//----------------------------------------------------------------------------------------------------------------------
