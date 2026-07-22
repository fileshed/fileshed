//----------------------------------------------------------------------------------------------------------------------
// Editor Colorscheme — the account-page theme picker
//
// Only the preferences RA is mocked; the real session store runs. The picker reflects the stored theme (resolved
// through the registry, so a stale id shows the fallback rather than a blank), choosing a theme saves it through the
// same preferences path the sibling account controls use and the store adopts the refreshed profile, and re-choosing
// the theme already in force is a no-op that never hits the wire.
//----------------------------------------------------------------------------------------------------------------------

import { type Mock, beforeEach, describe, expect, it, vi } from 'vitest';
import { type VueWrapper, flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';

import { DEFAULT_EDITOR_THEME, type MeResponse } from '@fileshed/core';

// Resource Access
import { updatePreferences } from '@client/resource-access/preferences.ts';

// Stores
import { useSessionStore } from '@client/stores/session.ts';

// Under test
import EditorColorScheme from '@client/components/account/editorColorScheme.vue';

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

const USelectMenuStub = {
    name: 'USelectMenu',
    props: [ 'modelValue', 'items', 'valueKey', 'searchInput', 'icon', 'disabled' ],
    emits: [ 'update:modelValue' ],
    template: '<select class="theme-select" :value="modelValue" '
        + '@change="$emit(\'update:modelValue\', ($event.target).value)">'
        + '<option v-for="option in items" :key="option.value" :value="option.value">{{ option.label }}</option>'
        + '</select>',
};

function mountPicker() : VueWrapper
{
    return mount(EditorColorScheme, { global: { stubs: { USelectMenu: USelectMenuStub } } });
}

function selectedValue(wrapper : VueWrapper) : string
{
    return (wrapper.find('.theme-select').element as HTMLSelectElement).value;
}

//----------------------------------------------------------------------------------------------------------------------

describe('EditorColorScheme', () =>
{
    beforeEach(() =>
    {
        setActivePinia(createPinia());
        vi.clearAllMocks();
    });

    it('shows the stored theme as the selected option', () =>
    {
        const session = useSessionStore();
        session.me = meFixture({ preferences: { editorTheme: 'nord' } });

        expect(selectedValue(mountPicker())).toBe('nord');
    });

    it('shows the default theme when the stored id is unknown', () =>
    {
        const session = useSessionStore();
        session.me = meFixture({ preferences: { editorTheme: 'a-theme-that-was-dropped' } });

        expect(selectedValue(mountPicker())).toBe(DEFAULT_EDITOR_THEME);
    });

    it('saves the chosen theme and the store adopts it', async () =>
    {
        const session = useSessionStore();
        session.me = meFixture({ preferences: { editorTheme: 'ayu-dark' } });
        updatePreferencesMock.mockResolvedValue(meFixture({ preferences: { editorTheme: 'monokai' } }));
        const wrapper = mountPicker();

        await wrapper.find('.theme-select').setValue('monokai');
        await flushPromises();

        expect(session.editorTheme).toBe('monokai');
        expect(updatePreferencesMock).toHaveBeenCalledWith({ editorTheme: 'monokai' });
    });

    it('does not hit the wire when the chosen theme is already in force', async () =>
    {
        const session = useSessionStore();
        session.me = meFixture({ preferences: { editorTheme: 'nord' } });
        const wrapper = mountPicker();

        await wrapper.find('.theme-select').setValue('nord');
        await flushPromises();

        expect(updatePreferencesMock).not.toHaveBeenCalled();
    });
});

//----------------------------------------------------------------------------------------------------------------------
