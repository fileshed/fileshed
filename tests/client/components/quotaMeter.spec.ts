//----------------------------------------------------------------------------------------------------------------------
// Quota Meter — the sidebar storage gauge
//
// The gauge reads the session quota: usage alone when nothing caps the account (no bar), used-of-cap with a bar when
// something does, and from 80% of the cap onward the whole gauge turns to the warning color -- bar and label both --
// so nearing the ceiling is visible at a glance. The denominator is always the effective cap, so an account that
// merely inherits the instance default is shown as capped rather than as unlimited.
//----------------------------------------------------------------------------------------------------------------------

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { type VueWrapper, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';

import type { MeResponse } from '@fileshed/core';

// Stores
import { useSessionStore } from '@client/stores/session.ts';

// Under test
import QuotaMeter from '@client/components/quotaMeter.vue';

//----------------------------------------------------------------------------------------------------------------------

vi.mock('@nuxt/ui/composables', () => ({ useToast: () => ({ add: vi.fn() }) }));

//----------------------------------------------------------------------------------------------------------------------

function meFixture(quota : MeResponse['quota']) : MeResponse
{
    return {
        id: 'u1',
        email: 'member@example.com',
        role: 'user',
        quota,
        limits: { trashRetentionDays: 30 },
        preferences: {},
        createdAt: '2026-07-01T00:00:00.000Z',
    };
}

const UProgressStub = {
    name: 'UProgress',
    props: [ 'modelValue', 'max', 'color' ],
    template: '<div class="progress" :data-color="color" :data-max="max" />',
};

const UTooltipStub = {
    name: 'UTooltip',
    props: [ 'text', 'disabled' ],
    template: '<div class="tooltip" :data-text="text" :data-disabled="String(disabled)"><slot /></div>',
};

function mountMeter(quota : MeResponse['quota']) : VueWrapper
{
    useSessionStore().me = meFixture(quota);

    return mount(QuotaMeter, { global: { stubs: { UProgress: UProgressStub, UTooltip: UTooltipStub } } });
}

//----------------------------------------------------------------------------------------------------------------------

describe('QuotaMeter', () =>
{
    beforeEach(() =>
    {
        setActivePinia(createPinia());
    });

    it('shows usage alone with no bar and a disabled tooltip for an unlimited account', () =>
    {
        const wrapper = mountMeter({ used: 4096, effective: null, limit: null });

        expect(wrapper.text()).toContain('4.1 kB used');
        expect(wrapper.find('.progress').exists()).toBe(false);
        expect(wrapper.find('.tooltip').attributes('data-disabled')).toBe('true');
    });

    it('measures against the inherited instance cap for an account with no limit of its own', () =>
    {
        const wrapper = mountMeter({ used: 9000, effective: 10_000, limit: null });

        expect(wrapper.text()).toContain('9 kB of 10 kB');
        expect(wrapper.find('.progress').attributes('data-max')).toBe('10000');
        expect(wrapper.find('.tooltip').attributes('data-text')).toBe('90% of your storage used');
    });

    it('carries the consumed percentage as the hover tooltip when capped', () =>
    {
        const wrapper = mountMeter({ used: 9000, effective: 10_000, limit: 10_000 });

        const tooltip = wrapper.find('.tooltip');
        expect(tooltip.attributes('data-text')).toBe('90% of your storage used');
        expect(tooltip.attributes('data-disabled')).toBe('false');
    });

    it('shows used-of-limit with a normal bar while comfortably under the cap', () =>
    {
        const wrapper = mountMeter({ used: 1000, effective: 10_000, limit: 10_000 });

        expect(wrapper.text()).toContain('1 kB of 10 kB');
        expect(wrapper.find('.progress').attributes('data-color')).toBe('primary');
        expect(wrapper.find('.text-error').exists()).toBe(false);
    });

    it('turns the bar and the label to the warning color from 80% of the cap', () =>
    {
        const wrapper = mountMeter({ used: 8000, effective: 10_000, limit: 10_000 });

        expect(wrapper.find('.progress').attributes('data-color')).toBe('error');
        expect(wrapper.find('.text-error').exists()).toBe(true);
    });

    it('stays normal just under the threshold', () =>
    {
        const wrapper = mountMeter({ used: 7999, effective: 10_000, limit: 10_000 });

        expect(wrapper.find('.progress').attributes('data-color')).toBe('primary');
        expect(wrapper.find('.text-error').exists()).toBe(false);
    });

    it('treats an account pinned unlimited above a capped instance default as uncapped', () =>
    {
        const wrapper = mountMeter({ used: 4096, effective: null, limit: 0 });

        expect(wrapper.text()).toContain('4.1 kB used');
        expect(wrapper.find('.progress').exists()).toBe(false);
    });
});

//----------------------------------------------------------------------------------------------------------------------
