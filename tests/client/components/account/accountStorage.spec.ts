//----------------------------------------------------------------------------------------------------------------------
// Account Storage — the account-page usage summary
//
// The real session store runs; nothing touches the wire. The label always carries a denominator -- "Unlimited" when
// no quota is set -- and the progress bar appears only when a limit exists to measure against.
//----------------------------------------------------------------------------------------------------------------------

import { beforeEach, describe, expect, it } from 'vitest';
import { type VueWrapper, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';

import type { MeResponse } from '@fileshed/core';

// Stores
import { useSessionStore } from '@client/stores/session.ts';

// Under test
import AccountStorage from '@client/components/account/accountStorage.vue';

//----------------------------------------------------------------------------------------------------------------------

function meFixture(overrides : Partial<MeResponse> = {}) : MeResponse
{
    return {
        id: 'user_1',
        email: 'member@example.com',
        role: 'user',
        quota: { used: 0, limit: null },
        limits: { trashRetentionDays: 30 },
        preferences: {},
        createdAt: '2026-07-20T00:00:00.000Z',
        ...overrides,
    };
}

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

    it('shows usage over "Unlimited" with no progress bar when no quota is set', () =>
    {
        const session = useSessionStore();
        session.me = meFixture({ quota: { used: 218_800, limit: null } });

        const wrapper = mountStorage();

        expect(wrapper.text()).toContain('218.8 KB used / Unlimited');
        expect(wrapper.find('.progress').exists()).toBe(false);
    });

    it('shows usage over the limit with a progress bar when a quota is set', () =>
    {
        const session = useSessionStore();
        session.me = meFixture({ quota: { used: 1_000_000_000, limit: 5_000_000_000 } });

        const wrapper = mountStorage();

        expect(wrapper.text()).toContain('1 GB used / 5 GB');

        const progress = wrapper.get('.progress');
        expect(progress.attributes('data-value')).toBe('1000000000');
        expect(progress.attributes('data-max')).toBe('5000000000');
    });

    it('carries the consumed percentage as the hover tooltip when capped', () =>
    {
        const session = useSessionStore();
        session.me = meFixture({ quota: { used: 1_000_000_000, limit: 5_000_000_000 } });

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
