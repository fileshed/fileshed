//----------------------------------------------------------------------------------------------------------------------
// Time Format — the account-page clock-style toggle
//
// Only the preferences RA is mocked; the real session store runs. The active segment mirrors the current preference,
// choosing the other option saves it and the store adopts the refreshed profile, and re-choosing the option already in
// force is a no-op that never hits the wire.
//----------------------------------------------------------------------------------------------------------------------

import { type Mock, beforeEach, describe, expect, it, vi } from 'vitest';
import { type VueWrapper, flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';

import type { MeResponse } from '@fileshed/core';

// Resource Access
import { updatePreferences } from '@client/resource-access/preferences.ts';

// Stores
import { useSessionStore } from '@client/stores/session.ts';

// Under test
import TimeFormat from '@client/components/account/timeFormat.vue';

//----------------------------------------------------------------------------------------------------------------------

vi.mock('@client/resource-access/preferences.ts', () => ({ updatePreferences: vi.fn() }));
vi.mock('@nuxt/ui/composables', () => ({ useToast: () => ({ add: vi.fn() }) }));

const updatePreferencesMock = updatePreferences as unknown as Mock;

//----------------------------------------------------------------------------------------------------------------------

function meFixture(overrides : Partial<MeResponse> = {}) : MeResponse
{
    return {
        id: 'user_1',
        email: 'member@example.com',
        role: 'user',
        quota: { used: 0, limit: null },
        preferences: {},
        createdAt: '2026-07-20T00:00:00.000Z',
        ...overrides,
    };
}

const UFieldGroupStub = { template: '<div><slot /></div>' };

const UButtonStub = {
    name: 'UButton',
    props: [ 'label', 'variant', 'color', 'disabled' ],
    emits: [ 'click' ],
    template: '<button class="fmt-btn" :data-variant="variant" :disabled="disabled" '
        + '@click="$emit(\'click\')">{{ label }}</button>',
};

function mountToggle() : VueWrapper
{
    return mount(TimeFormat, { global: { stubs: { UFieldGroup: UFieldGroupStub, UButton: UButtonStub } } });
}

//----------------------------------------------------------------------------------------------------------------------

describe('TimeFormat', () =>
{
    beforeEach(() =>
    {
        setActivePinia(createPinia());
        vi.clearAllMocks();
    });

    it('marks the current preference as the active segment', () =>
    {
        const session = useSessionStore();
        session.me = meFixture({ preferences: { timeFormat: '12h' } });

        const buttons = mountToggle().findAll('.fmt-btn');

        expect(buttons[0]?.attributes('data-variant')).toBe('solid');
        expect(buttons[1]?.attributes('data-variant')).toBe('outline');
    });

    it('saves the chosen format and the store adopts it', async () =>
    {
        const session = useSessionStore();
        session.me = meFixture({ preferences: { timeFormat: '12h' } });
        updatePreferencesMock.mockResolvedValue(meFixture({ preferences: { timeFormat: '24h' } }));
        const wrapper = mountToggle();

        await wrapper.findAll('.fmt-btn')[1]?.trigger('click');
        await flushPromises();

        expect(session.timeFormat).toBe('24h');
        expect(updatePreferencesMock).toHaveBeenCalledWith({ timeFormat: '24h' });
    });

    it('does not hit the wire when the chosen format is already in force', async () =>
    {
        const session = useSessionStore();
        session.me = meFixture({ preferences: { timeFormat: '12h' } });
        const wrapper = mountToggle();

        await wrapper.findAll('.fmt-btn')[0]?.trigger('click');
        await flushPromises();

        expect(updatePreferencesMock).not.toHaveBeenCalled();
    });
});

//----------------------------------------------------------------------------------------------------------------------
