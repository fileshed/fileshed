//----------------------------------------------------------------------------------------------------------------------
// Setting Field — one instance setting as an editable card
//
// Only the admin RA is mocked; the real store runs, and the field is mounted under a reactive host feeding it
// store.entries[0], the way the settings tab does -- so a save proves the whole path: the field dispatches the
// patch, the store adopts the refreshed view, and the card re-renders what the server settled on. Boolean keys
// save on toggle; number keys demand an explicit Save that stays dead until the draft is a changed, whole,
// non-negative number; the Reset control exists only while an override hides an actual default underneath.
//----------------------------------------------------------------------------------------------------------------------

import { type Mock, beforeEach, describe, expect, it, vi } from 'vitest';
import { type VueWrapper, flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';

import type { AdminSettingEntry, AdminSettingsResponse } from '@fileshed/core';

// Resource Access
import { patchAdminSettings } from '@client/resource-access/admin.ts';

// Stores
import { useAdminSettingsStore } from '@client/stores/adminSettings.ts';

// Under test
import SettingField from '@client/components/admin/settingField.vue';

//----------------------------------------------------------------------------------------------------------------------

vi.mock('@client/resource-access/admin.ts', () => ({
    fetchAdminSettings: vi.fn(),
    patchAdminSettings: vi.fn(),
}));
vi.mock('@nuxt/ui/composables', () => ({ useToast: () => ({ add: vi.fn() }) }));

const patchMock = patchAdminSettings as unknown as Mock;

//----------------------------------------------------------------------------------------------------------------------

function numberEntry(overrides : Partial<AdminSettingEntry> = {}) : AdminSettingEntry
{
    return {
        key: 'UPLOAD_MAX_BYTES',
        kind: 'number',
        secret: false,
        requiresRestart: false,
        value: 1000,
        source: 'default',
        hasDefault: true,
        ...overrides,
    };
}

function booleanEntry(overrides : Partial<AdminSettingEntry> = {}) : AdminSettingEntry
{
    return {
        key: 'SIGN_UP_ENABLED',
        kind: 'boolean',
        secret: false,
        requiresRestart: false,
        value: true,
        source: 'default',
        hasDefault: true,
        ...overrides,
    };
}

function response(entries : AdminSettingEntry[]) : AdminSettingsResponse
{
    return { settings: entries, restartRequired: false };
}

const UInputStub = {
    name: 'UInput',
    props: [ 'modelValue', 'placeholder' ],
    emits: [ 'update:modelValue' ],
    template: '<input class="value-input" :value="modelValue" :placeholder="placeholder" '
        + '@input="$emit(\'update:modelValue\', $event.target.value)" />',
};

const UButtonStub = {
    name: 'UButton',
    props: [ 'label', 'disabled', 'loading' ],
    emits: [ 'click' ],
    template: '<button :class="`btn-${ label?.toLowerCase().replace(/ /g, \'-\') }`" :disabled="disabled" '
        + '@click="$emit(\'click\')">{{ label }}</button>',
};

const USwitchStub = {
    name: 'USwitch',
    props: [ 'modelValue', 'disabled' ],
    emits: [ 'update:modelValue' ],
    template: '<button class="switch" :data-on="modelValue" '
        + '@click="$emit(\'update:modelValue\', !modelValue)" />',
};

const UBadgeStub = {
    name: 'UBadge',
    props: [ 'label' ],
    template: '<span class="badge">{{ label }}</span>',
};

// The tab feeds the field from store.entries, so a save's refreshed view re-renders the card; this host mirrors
// that wiring.
function mountField(entry : AdminSettingEntry, unit ?: 'bytes' | 'days') : VueWrapper
{
    const store = useAdminSettingsStore();
    store.entries = [ entry ];

    return mount({
        components: { SettingField },
        setup: () => ({ store, unit }),
        template: '<SettingField v-if="store.entries[0]" :entry="store.entries[0]" '
            + 'label="Test setting" description="What it does." :unit="unit" />',
    }, { global: { stubs: { UInput: UInputStub, UButton: UButtonStub, USwitch: USwitchStub, UBadge: UBadgeStub } } });
}

function saveButton(wrapper : VueWrapper) : HTMLButtonElement
{
    return wrapper.find('.btn-save').element as HTMLButtonElement;
}

//----------------------------------------------------------------------------------------------------------------------

describe('SettingField', () =>
{
    beforeEach(() =>
    {
        setActivePinia(createPinia());
        vi.clearAllMocks();
    });

    it('saves a boolean key on toggle and the store adopts the override', async () =>
    {
        patchMock.mockResolvedValue(response([ booleanEntry({ value: false, source: 'override' }) ]));
        const wrapper = mountField(booleanEntry());

        await wrapper.find('.switch').trigger('click');
        await flushPromises();

        expect(patchMock).toHaveBeenCalledWith({ SIGN_UP_ENABLED: false });
        expect(wrapper.find('.switch').attributes('data-on')).toBe('false');
    });

    it('leaves Save dead until the number draft differs from the effective value', async () =>
    {
        const wrapper = mountField(numberEntry({ value: 1000 }));

        expect(saveButton(wrapper).disabled).toBe(true);

        await wrapper.find('.value-input').setValue('2000');
        expect(saveButton(wrapper).disabled).toBe(false);
    });

    it('refuses to save a negative or fractional draft', async () =>
    {
        const wrapper = mountField(numberEntry({ value: 1000 }));

        await wrapper.find('.value-input').setValue('-5');
        expect(saveButton(wrapper).disabled).toBe(true);

        await wrapper.find('.value-input').setValue('1.5');
        expect(saveButton(wrapper).disabled).toBe(true);
    });

    it('saves a changed number and shows what the server settled on, not what was typed', async () =>
    {
        patchMock.mockResolvedValue(response([ numberEntry({ value: 3000, source: 'override' }) ]));
        const wrapper = mountField(numberEntry({ value: 1000 }));

        await wrapper.find('.value-input').setValue('2000');
        await wrapper.find('.btn-save').trigger('click');
        await flushPromises();

        expect(patchMock).toHaveBeenCalledWith({ UPLOAD_MAX_BYTES: 2000 });
        expect((wrapper.find('.value-input').element as HTMLInputElement).value).toBe('3000');
    });

    it('takes a human size on a bytes field, echoing the parsed byte count, and saves the bytes', async () =>
    {
        patchMock.mockResolvedValue(response([ numberEntry({ value: 20_000_000_000, source: 'override' }) ]));
        const wrapper = mountField(numberEntry({ value: 1000 }), 'bytes');

        await wrapper.find('.value-input').setValue('20gb');

        expect(wrapper.text()).toContain(`= ${ (20_000_000_000).toLocaleString() } bytes`);
        expect(saveButton(wrapper).disabled).toBe(false);

        await wrapper.find('.btn-save').trigger('click');
        await flushPromises();

        expect(patchMock).toHaveBeenCalledWith({ UPLOAD_MAX_BYTES: 20_000_000_000 });
    });

    it('refuses a draft that is not a size on a bytes field', async () =>
    {
        const wrapper = mountField(numberEntry({ value: 1000 }), 'bytes');

        await wrapper.find('.value-input').setValue('20 gigawatts');

        expect(saveButton(wrapper).disabled).toBe(true);
    });

    it('offers Reset only while an override is in play, and resets with the null patch', async () =>
    {
        patchMock.mockResolvedValue(response([ numberEntry({ value: 1000, source: 'default' }) ]));
        const wrapper = mountField(numberEntry({ value: 2000, source: 'override' }));

        await wrapper.find('.btn-reset-to-default').trigger('click');
        await flushPromises();

        expect(patchMock).toHaveBeenCalledWith({ UPLOAD_MAX_BYTES: null });
        expect(wrapper.find('.btn-reset-to-default').exists()).toBe(false);
    });

    it('shows neither Overridden nor Reset when no default lies underneath the stored value', () =>
    {
        const wrapper = mountField(numberEntry({
            key: 'GITLAB_CLIENT_ID',
            kind: 'string',
            value: 'gl-id',
            source: 'override',
            hasDefault: false,
        }));

        expect(wrapper.find('.btn-reset-to-default').exists()).toBe(false);
        expect(wrapper.findAll('.badge').map((badge) => badge.text())).not.toContain('Overridden');
    });

    it('badges an override and a restart-requiring key', () =>
    {
        const wrapper = mountField(numberEntry({ source: 'override', requiresRestart: true }));

        const badges = wrapper.findAll('.badge').map((badge) => badge.text());
        expect(badges).toContain('Overridden');
        expect(badges).toContain('Needs restart');
    });

    //------------------------------------------------------------------------------------------------------------------
    // String and secret fields
    //------------------------------------------------------------------------------------------------------------------

    function stringEntry(overrides : Partial<AdminSettingEntry> = {}) : AdminSettingEntry
    {
        return {
            key: 'SMTP_HOST',
            kind: 'string',
            secret: false,
            requiresRestart: false,
            value: null,
            source: 'default',
            hasDefault: false,
            ...overrides,
        };
    }

    it('saves a trimmed string and refuses an empty or unchanged draft', async () =>
    {
        patchMock.mockResolvedValue(response([ stringEntry({ value: 'smtp.example.com', source: 'override' }) ]));
        const wrapper = mountField(stringEntry());

        expect(saveButton(wrapper).disabled).toBe(true);

        await wrapper.find('.value-input').setValue('  smtp.example.com  ');
        await wrapper.find('.btn-save').trigger('click');
        await flushPromises();

        expect(patchMock).toHaveBeenCalledWith({ SMTP_HOST: 'smtp.example.com' });
        expect(saveButton(wrapper).disabled).toBe(true);
    });

    it('keeps a secret write-only: empty field, the mask as placeholder, and any entry saveable', async () =>
    {
        patchMock.mockResolvedValue(response([
            stringEntry({ key: 'SMTP_PASSWORD', secret: true, value: '••••cret', source: 'override' }),
        ]));
        const wrapper = mountField(stringEntry({ key: 'SMTP_PASSWORD', secret: true, value: '••••ord2' }));

        const input = wrapper.find('.value-input').element as HTMLInputElement;
        expect(input.value).toBe('');
        expect(input.placeholder).toBe('••••ord2');

        await wrapper.find('.value-input').setValue('hunter2-smtp-secret');
        expect(saveButton(wrapper).disabled).toBe(false);

        await wrapper.find('.btn-save').trigger('click');
        await flushPromises();

        expect(patchMock).toHaveBeenCalledWith({ SMTP_PASSWORD: 'hunter2-smtp-secret' });
        expect((wrapper.find('.value-input').element as HTMLInputElement).value).toBe('');
    });
});

//----------------------------------------------------------------------------------------------------------------------
