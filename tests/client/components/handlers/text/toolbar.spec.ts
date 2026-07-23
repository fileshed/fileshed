//----------------------------------------------------------------------------------------------------------------------
// Editor Toolbar — the colorscheme picker and gutter toggle
//
// Only the preferences RA is mocked; the real session store runs. A pick or toggle applies to the session at once (so
// the editor swaps live) and persists the settled value after a short quiet period -- arrowing through several themes
// must write once, not once per pick, and a burst that touches both keys coalesces into one patch. Re-choosing the
// theme already in force never touches the wire, and leaving the editor before the quiet period elapses still persists.
//----------------------------------------------------------------------------------------------------------------------

import { type Mock, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type VueWrapper, flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';

import type { MeResponse } from '@fileshed/core';

// Resource Access
import { updatePreferences } from '@client/resource-access/preferences.ts';

// Stores
import { useSessionStore } from '@client/stores/session.ts';

// Under test
import EditorToolbar from '@client/components/handlers/text/toolbar.vue';

//----------------------------------------------------------------------------------------------------------------------

vi.mock('@client/resource-access/preferences.ts', () => ({ updatePreferences: vi.fn() }));
vi.mock('@nuxt/ui/composables', () => ({ useToast: () => ({ add: vi.fn() }) }));

const updatePreferencesMock = updatePreferences as unknown as Mock;

// The debounce the toolbar waits out before persisting a settled view preference.
const PERSIST_DEBOUNCE_MS = 500;

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

const UButtonStub = {
    name: 'UButton',
    props: [ 'icon', 'label', 'variant', 'color', 'size', 'loading', 'disabled', 'ariaLabel' ],
    emits: [ 'click' ],
    template: '<button :data-icon="icon" :data-variant="variant" @click="$emit(\'click\')">{{ label }}</button>',
};

const USelectMenuStub = {
    name: 'USelectMenu',
    props: [ 'modelValue', 'items', 'valueKey', 'searchInput', 'size', 'color', 'variant', 'icon', 'ui' ],
    emits: [ 'update:modelValue' ],
    template: '<select class="theme-select" :value="modelValue" '
        + '@change="$emit(\'update:modelValue\', ($event.target).value)">'
        + '<option v-for="option in items" :key="option.value" :value="option.value">{{ option.label }}</option>'
        + '</select>',
};

const stubs = {
    UButton: UButtonStub,
    USelectMenu: USelectMenuStub,
    UFieldGroup: { template: '<div><slot /></div>' },
    UBadge: { template: '<span><slot /></span>', props: [ 'label', 'icon', 'color', 'variant' ] },
    UIcon: { template: '<i />', props: [ 'name' ] },
};

function mountToolbar() : VueWrapper
{
    return mount(EditorToolbar, { global: { stubs } });
}

const gutterButton = '[data-icon="i-lucide-list-ordered"]';

//----------------------------------------------------------------------------------------------------------------------

describe('EditorToolbar view preferences', () =>
{
    beforeEach(() =>
    {
        setActivePinia(createPinia());
        vi.clearAllMocks();
        vi.useFakeTimers();
    });

    afterEach(() =>
    {
        vi.useRealTimers();
    });

    it('applies a picked theme to the session at once, before any persist', async () =>
    {
        const session = useSessionStore();
        session.me = meFixture({ preferences: { editorTheme: 'ayu-dark' } });
        const wrapper = mountToolbar();

        await wrapper.find('.theme-select').setValue('nord');

        expect(session.editorTheme).toBe('nord');
        expect(updatePreferencesMock).not.toHaveBeenCalled();
    });

    it('persists only the settled theme once after a burst of picks', async () =>
    {
        const session = useSessionStore();
        session.me = meFixture({ preferences: { editorTheme: 'ayu-dark' } });
        updatePreferencesMock.mockResolvedValue(meFixture({ preferences: { editorTheme: 'monokai' } }));
        const wrapper = mountToolbar();

        await wrapper.find('.theme-select').setValue('nord');
        await wrapper.find('.theme-select').setValue('monokai');

        vi.advanceTimersByTime(PERSIST_DEBOUNCE_MS);
        await flushPromises();

        expect(updatePreferencesMock).toHaveBeenCalledTimes(1);
        expect(updatePreferencesMock).toHaveBeenCalledWith({ editorTheme: 'monokai' });
    });

    it('toggles the gutter, applying it live and persisting the new value', async () =>
    {
        const session = useSessionStore();
        session.me = meFixture({ preferences: { editorGutter: false } });
        updatePreferencesMock.mockResolvedValue(meFixture({ preferences: { editorGutter: true } }));
        const wrapper = mountToolbar();

        await wrapper.find(gutterButton).trigger('click');
        expect(session.editorGutter).toBe(true);

        vi.advanceTimersByTime(PERSIST_DEBOUNCE_MS);
        await flushPromises();

        expect(updatePreferencesMock).toHaveBeenCalledWith({ editorGutter: true });
    });

    it('coalesces a theme pick and a gutter toggle into a single patch', async () =>
    {
        const session = useSessionStore();
        session.me = meFixture({ preferences: { editorTheme: 'ayu-dark', editorGutter: false } });
        updatePreferencesMock.mockResolvedValue(meFixture());
        const wrapper = mountToolbar();

        await wrapper.find('.theme-select').setValue('nord');
        await wrapper.find(gutterButton).trigger('click');

        vi.advanceTimersByTime(PERSIST_DEBOUNCE_MS);
        await flushPromises();

        expect(updatePreferencesMock).toHaveBeenCalledTimes(1);
        expect(updatePreferencesMock).toHaveBeenCalledWith({ editorTheme: 'nord', editorGutter: true });
    });

    it('does not hit the wire when the picked theme is already in force', async () =>
    {
        const session = useSessionStore();
        session.me = meFixture({ preferences: { editorTheme: 'nord' } });
        const wrapper = mountToolbar();

        await wrapper.find('.theme-select').setValue('nord');
        vi.advanceTimersByTime(PERSIST_DEBOUNCE_MS);
        await flushPromises();

        expect(updatePreferencesMock).not.toHaveBeenCalled();
    });

    it('persists a pending change when the editor is left before the quiet period elapses', async () =>
    {
        const session = useSessionStore();
        session.me = meFixture({ preferences: { editorTheme: 'ayu-dark' } });
        updatePreferencesMock.mockResolvedValue(meFixture());
        const wrapper = mountToolbar();

        await wrapper.find('.theme-select').setValue('nord');
        wrapper.unmount();
        await flushPromises();

        expect(updatePreferencesMock).toHaveBeenCalledWith({ editorTheme: 'nord' });
    });
});

//----------------------------------------------------------------------------------------------------------------------
