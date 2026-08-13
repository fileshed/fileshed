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
import { patchAdminSettings, runSweep } from '@client/resource-access/admin.ts';

// Stores
import { useAdminSettingsStore } from '@client/stores/adminSettings.ts';

// Under test
import SettingField from '@client/components/admin/settingField.vue';

//----------------------------------------------------------------------------------------------------------------------

vi.mock('@client/resource-access/admin.ts', () => ({
    fetchAdminSettings: vi.fn(),
    patchAdminSettings: vi.fn(),
    runSweep: vi.fn(),
}));
vi.mock('@nuxt/ui/composables', () => ({ useToast: () => ({ add: vi.fn() }) }));

const patchMock = patchAdminSettings as unknown as Mock;
const runSweepMock = runSweep as unknown as Mock;

const SWEPT = {
    sweep: 'gc' as const,
    ranAt: '2026-08-12T10:00:00.000Z',
    summary: { candidates: 0, deleted: 0, kept: 0, bytesFailed: 0, bytesFreed: 0 },
};

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
function mountField(entry : AdminSettingEntry, unit ?: 'bytes' | 'days', zeroLabel ?: string) : VueWrapper
{
    const store = useAdminSettingsStore();
    store.entries = [ entry ];

    return mount({
        components: { SettingField },
        setup: () => ({ store, unit, zeroLabel }),
        template: '<SettingField v-if="store.entries[0]" :entry="store.entries[0]" '
            + 'label="Test setting" description="What it does." :unit="unit" :zero-label="zeroLabel" />',
    }, { global: { stubs: { UInput: UInputStub, UButton: UButtonStub, USwitch: USwitchStub, UBadge: UBadgeStub } } });
}

// The same reactive host as mountField, for a retention key that also names the sweep it governs.
function mountGoverningField(entry : AdminSettingEntry) : VueWrapper
{
    const store = useAdminSettingsStore();
    store.entries = [ entry ];

    return mount({
        components: { SettingField },
        setup: () => ({ store }),
        template: '<SettingField v-if="store.entries[0]" :entry="store.entries[0]" '
            + 'label="Deleted file grace period" description="How long the bytes survive." unit="days" '
            + ':sweep="{ kind: \'gc\', label: \'Garbage collection\' }" />',
    }, { global: { stubs: { UInput: UInputStub, UButton: UButtonStub, USwitch: USwitchStub, UBadge: UBadgeStub } } });
}

function inputValue(wrapper : VueWrapper) : string
{
    return (wrapper.find('.value-input').element as HTMLInputElement).value;
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
        expect(inputValue(wrapper)).toBe('3000');
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

    it('prefills a bytes field with the stored size in human units', () =>
    {
        expect(inputValue(mountField(numberEntry({ value: 2_097_152 }), 'bytes'))).toBe('2.1 MB');
    });

    // The prefill is a rounded rendering, so reading it back as a size would store 2,100,000 for a field nobody
    // edited. Untouched means unchanged, and the echo underneath still names the count exactly.
    it('never drifts the stored count on a bytes field left untouched', async () =>
    {
        const wrapper = mountField(numberEntry({ value: 2_097_152 }), 'bytes');

        expect(saveButton(wrapper).disabled).toBe(true);
        expect(wrapper.text()).toContain(`= ${ (2_097_152).toLocaleString() } bytes (2.1 MB)`);

        await wrapper.find('.btn-save').trigger('click');
        await flushPromises();

        expect(patchMock).not.toHaveBeenCalled();
    });

    it('saves an edited bytes draft as the size it parses to', async () =>
    {
        patchMock.mockResolvedValue(response([ numberEntry({ value: 3_000_000_000, source: 'override' }) ]));
        const wrapper = mountField(numberEntry({ value: 2_097_152 }), 'bytes');

        await wrapper.find('.value-input').setValue('3gb');
        await wrapper.find('.btn-save').trigger('click');
        await flushPromises();

        expect(patchMock).toHaveBeenCalledWith({ UPLOAD_MAX_BYTES: 3_000_000_000 });
        expect(inputValue(wrapper)).toBe('3 GB');
    });

    // Zero is a sentinel on the quota key, so echoing "0 bytes" would contradict what the setting means.
    it('echoes a key\'s own word for zero, and the byte count for every other value', async () =>
    {
        const wrapper = mountField(numberEntry({ key: 'DEFAULT_QUOTA_BYTES', value: 0 }), 'bytes', 'Unlimited');

        expect(wrapper.text()).toContain('Unlimited');
        expect(wrapper.text()).not.toContain('0 bytes');

        await wrapper.find('.value-input').setValue('20gb');

        expect(wrapper.text()).toContain(`= ${ (20_000_000_000).toLocaleString() } bytes`);
        expect(wrapper.text()).not.toContain('Unlimited');
    });

    it('echoes a plain zero as a count of nothing on a key that gave no word for it', () =>
    {
        expect(mountField(numberEntry({ value: 0 }), 'bytes').text()).toContain('= 0 bytes (0 B)');
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
        expect(inputValue(wrapper)).toBe('');
    });

    //------------------------------------------------------------------------------------------------------------------
    // Constraints — the key's own bounds, spent on a refusal here instead of a round trip. The server checks these
    // regardless; an absent bound imposes nothing.
    //------------------------------------------------------------------------------------------------------------------

    it('refuses a number under the key\'s minimum and names the bound', async () =>
    {
        const wrapper = mountField(numberEntry({ value: 1000, constraints: { min: 1 } }), 'bytes');

        await wrapper.find('.value-input').setValue('0');

        expect(saveButton(wrapper).disabled).toBe(true);
        expect(wrapper.text()).toContain('Must be at least 1 B.');

        await wrapper.find('.btn-save').trigger('click');
        await flushPromises();

        expect(patchMock).not.toHaveBeenCalled();
    });

    it('refuses a number over the key\'s maximum and names the bound', async () =>
    {
        const wrapper = mountField(numberEntry({
            key: 'SMTP_PORT',
            value: 587,
            constraints: { min: 1, max: 65_535 },
        }));

        await wrapper.find('.value-input').setValue('70000');

        expect(saveButton(wrapper).disabled).toBe(true);
        expect(wrapper.text()).toContain('Must be at most 65535.');
    });

    it('refuses a string longer than the key\'s maximum length', async () =>
    {
        const wrapper = mountField(stringEntry({ key: 'INSTANCE_NAME', constraints: { maxLength: 5 } }));

        await wrapper.find('.value-input').setValue('much too long');

        expect(saveButton(wrapper).disabled).toBe(true);
        expect(wrapper.text()).toContain('Must be 5 characters or fewer.');
    });

    it('accepts a value sitting exactly on a bound', async () =>
    {
        const wrapper = mountField(numberEntry({ value: 1000, constraints: { min: 1, max: 2000 } }));

        await wrapper.find('.value-input').setValue('2000');

        expect(saveButton(wrapper).disabled).toBe(false);
    });

    it('imposes nothing on a key that carries no bounds', async () =>
    {
        const wrapper = mountField(numberEntry({ value: 1000 }));

        await wrapper.find('.value-input').setValue('0');

        expect(saveButton(wrapper).disabled).toBe(false);
    });

    // A retention key can say which sweep enforces it, and then the card offers to run that sweep. Most keys enforce
    // nothing on a schedule and must not grow a button that would have no meaning.
    it('offers to run the sweep a setting governs, and offers nothing on a setting that governs none', () =>
    {
        const governing = mountGoverningField(numberEntry({ key: 'GC_GRACE_DAYS', value: 7 }));
        const governingNone = mountField(numberEntry({ value: 1000 }));

        expect(governing.find('.btn-run-now').exists()).toBe(true);
        expect(governingNone.find('.btn-run-now').exists()).toBe(false);
    });

    // Run now sits on the same card as the retention it enforces. Started while a new window is typed but unsaved,
    // the sweep would use the old one -- permanently deleting exactly what the admin was raising it to keep.
    it('will not run the sweep while the card holds a value the admin has not saved', async () =>
    {
        const wrapper = mountGoverningField(numberEntry({ key: 'GC_GRACE_DAYS', value: 7 }));

        await wrapper.find('.value-input').setValue('30');
        await wrapper.find('.btn-run-now').trigger('click');
        await flushPromises();

        expect(runSweepMock).not.toHaveBeenCalled();
    });

    it('runs the sweep once the value the admin typed has been saved', async () =>
    {
        const entry = numberEntry({ key: 'GC_GRACE_DAYS', value: 7 });
        const wrapper = mountGoverningField(entry);

        patchMock.mockResolvedValue(response([ { ...entry, value: 30, source: 'override' } ]));
        runSweepMock.mockResolvedValue(SWEPT);

        await wrapper.find('.value-input').setValue('30');
        await wrapper.find('.btn-save').trigger('click');
        await flushPromises();

        await wrapper.find('.btn-run-now').trigger('click');
        await flushPromises();

        expect(runSweepMock).toHaveBeenCalledWith('gc');
    });
});

//----------------------------------------------------------------------------------------------------------------------
