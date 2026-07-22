//----------------------------------------------------------------------------------------------------------------------
// Editor Gutter — the account-page line-numbers toggle
//
// Only the preferences RA is mocked; the real session store runs. The switch reflects the stored gutter preference
// (default off), and flipping it saves the new value through the same preferences path the sibling account controls
// use, so an open editor shows or hides its gutter to match.
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
import EditorGutter from '@client/components/account/editorGutter.vue';

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

const USwitchStub = {
    name: 'USwitch',
    props: [ 'modelValue', 'disabled' ],
    emits: [ 'update:modelValue' ],
    template: '<button class="gutter-switch" :data-on="modelValue" '
        + '@click="$emit(\'update:modelValue\', !modelValue)"></button>',
};

function mountToggle() : VueWrapper
{
    return mount(EditorGutter, { global: { stubs: { USwitch: USwitchStub } } });
}

//----------------------------------------------------------------------------------------------------------------------

describe('EditorGutter', () =>
{
    beforeEach(() =>
    {
        setActivePinia(createPinia());
        vi.clearAllMocks();
    });

    it('reflects the stored gutter preference', () =>
    {
        const session = useSessionStore();
        session.me = meFixture({ preferences: { editorGutter: true } });

        const toggle = mountToggle().find('.gutter-switch');

        expect(toggle.attributes('data-on')).toBe('true');
    });

    it('defaults to off when no gutter preference is set', () =>
    {
        const session = useSessionStore();
        session.me = meFixture({ preferences: {} });

        const toggle = mountToggle().find('.gutter-switch');

        expect(toggle.attributes('data-on')).toBe('false');
    });

    it('turns the gutter on and the store adopts it', async () =>
    {
        const session = useSessionStore();
        session.me = meFixture({ preferences: {} });
        updatePreferencesMock.mockResolvedValue(meFixture({ preferences: { editorGutter: true } }));
        const wrapper = mountToggle();

        await wrapper.find('.gutter-switch').trigger('click');
        await flushPromises();

        expect(session.editorGutter).toBe(true);
        expect(updatePreferencesMock).toHaveBeenCalledWith({ editorGutter: true });
    });

    it('turns the gutter off when it was on', async () =>
    {
        const session = useSessionStore();
        session.me = meFixture({ preferences: { editorGutter: true } });
        updatePreferencesMock.mockResolvedValue(meFixture({ preferences: { editorGutter: false } }));
        const wrapper = mountToggle();

        await wrapper.find('.gutter-switch').trigger('click');
        await flushPromises();

        expect(updatePreferencesMock).toHaveBeenCalledWith({ editorGutter: false });
    });
});

//----------------------------------------------------------------------------------------------------------------------
