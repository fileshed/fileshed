//----------------------------------------------------------------------------------------------------------------------
// Files Root Name — the account-page root-label editor
//
// Only the preferences RA is mocked; the real session store runs, so a save proves the whole path -- the component
// trims and dispatches the patch, the store adopts the refreshed profile, and the label every surface reads updates.
// Save is live only when the draft differs from what is stored, and an emptied field clears the preference (null),
// dropping the root back to its default.
//----------------------------------------------------------------------------------------------------------------------

import { type Mock, beforeEach, describe, expect, it, vi } from 'vitest';
import { type VueWrapper, flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';

import { DEFAULT_ROOT_LABEL, type MeResponse } from '@fileshed/core';

// Resource Access
import { updatePreferences } from '@client/resource-access/preferences.ts';

// Stores
import { useSessionStore } from '@client/stores/session.ts';

// Under test
import FilesRootName from '@client/components/account/filesRootName.vue';

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
        quota: { used: 0, effective: null, limit: null },
        limits: { trashRetentionDays: 30 },
        preferences: {},
        createdAt: '2026-07-20T00:00:00.000Z',
        ...overrides,
    };
}

const UInputStub = {
    name: 'UInput',
    props: [ 'modelValue' ],
    emits: [ 'update:modelValue' ],
    template: '<input class="root-input" :value="modelValue" '
        + '@input="$emit(\'update:modelValue\', $event.target.value)" />',
};

const UButtonStub = {
    name: 'UButton',
    props: [ 'label', 'disabled', 'loading' ],
    emits: [ 'click' ],
    template: '<button class="save-btn" :disabled="disabled" @click="$emit(\'click\')">{{ label }}</button>',
};

function mountEditor() : VueWrapper
{
    return mount(FilesRootName, { global: { stubs: { UInput: UInputStub, UButton: UButtonStub } } });
}

function saveButton(wrapper : VueWrapper) : HTMLButtonElement
{
    return wrapper.find('.save-btn').element as HTMLButtonElement;
}

//----------------------------------------------------------------------------------------------------------------------

describe('FilesRootName', () =>
{
    beforeEach(() =>
    {
        setActivePinia(createPinia());
        vi.clearAllMocks();
    });

    it('leaves Save disabled while the draft matches the stored name', () =>
    {
        const session = useSessionStore();
        session.me = meFixture({ preferences: { rootLabel: 'Work' } });

        const wrapper = mountEditor();

        expect(saveButton(wrapper).disabled).toBe(true);
    });

    it('saves a trimmed new name and the store adopts it', async () =>
    {
        const session = useSessionStore();
        session.me = meFixture({ preferences: {} });
        updatePreferencesMock.mockResolvedValue(meFixture({ preferences: { rootLabel: 'Photos' } }));
        const wrapper = mountEditor();

        await wrapper.find('.root-input').setValue('  Photos  ');
        await wrapper.find('.save-btn').trigger('click');
        await flushPromises();

        expect(session.rootLabel).toBe('Photos');
        expect(updatePreferencesMock).toHaveBeenCalledWith({ rootLabel: 'Photos' });
    });

    it('clears the preference with a null patch when the field is emptied', async () =>
    {
        const session = useSessionStore();
        session.me = meFixture({ preferences: { rootLabel: 'Work' } });
        updatePreferencesMock.mockResolvedValue(meFixture({ preferences: {} }));
        const wrapper = mountEditor();

        await wrapper.find('.root-input').setValue('');
        await wrapper.find('.save-btn').trigger('click');
        await flushPromises();

        expect(session.rootLabel).toBe(DEFAULT_ROOT_LABEL);
        expect(updatePreferencesMock).toHaveBeenCalledWith({ rootLabel: null });
    });
});

//----------------------------------------------------------------------------------------------------------------------
