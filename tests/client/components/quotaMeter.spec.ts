//----------------------------------------------------------------------------------------------------------------------
// Quota Meter — the sidebar storage gauge
//
// The gauge reads the session quota: usage alone when unlimited (no bar), used-of-limit with a bar when capped, and
// from 80% of the cap onward the whole gauge turns to the warning color -- bar and label both -- so nearing the
// ceiling is visible at a glance.
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

function meFixture(used : number, limit : number | null) : MeResponse
{
    return {
        id: 'u1',
        email: 'member@example.com',
        role: 'user',
        quota: { used, limit },
        limits: { trashRetentionDays: 30 },
        preferences: {},
        createdAt: '2026-07-01T00:00:00.000Z',
    };
}

const UProgressStub = {
    name: 'UProgress',
    props: [ 'modelValue', 'max', 'color' ],
    template: '<div class="progress" :data-color="color" />',
};

const UTooltipStub = {
    name: 'UTooltip',
    props: [ 'text', 'disabled' ],
    template: '<div class="tooltip" :data-text="text" :data-disabled="String(disabled)"><slot /></div>',
};

function mountMeter(used : number, limit : number | null) : VueWrapper
{
    useSessionStore().me = meFixture(used, limit);

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
        const wrapper = mountMeter(4096, null);

        expect(wrapper.text()).toContain('4.1 KB used');
        expect(wrapper.find('.progress').exists()).toBe(false);
        expect(wrapper.find('.tooltip').attributes('data-disabled')).toBe('true');
    });

    it('carries the consumed percentage as the hover tooltip when capped', () =>
    {
        const wrapper = mountMeter(9000, 10_000);

        const tooltip = wrapper.find('.tooltip');
        expect(tooltip.attributes('data-text')).toBe('90% of your storage used');
        expect(tooltip.attributes('data-disabled')).toBe('false');
    });

    it('shows used-of-limit with a normal bar while comfortably under the cap', () =>
    {
        const wrapper = mountMeter(1000, 10_000);

        expect(wrapper.text()).toContain('1 KB of 10 KB');
        expect(wrapper.find('.progress').attributes('data-color')).toBe('primary');
        expect(wrapper.find('.text-error').exists()).toBe(false);
    });

    it('turns the bar and the label to the warning color from 80% of the cap', () =>
    {
        const wrapper = mountMeter(8000, 10_000);

        expect(wrapper.find('.progress').attributes('data-color')).toBe('error');
        expect(wrapper.find('.text-error').exists()).toBe(true);
    });

    it('stays normal just under the threshold', () =>
    {
        const wrapper = mountMeter(7999, 10_000);

        expect(wrapper.find('.progress').attributes('data-color')).toBe('primary');
        expect(wrapper.find('.text-error').exists()).toBe(false);
    });
});

//----------------------------------------------------------------------------------------------------------------------
