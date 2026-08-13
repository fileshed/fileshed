//----------------------------------------------------------------------------------------------------------------------
// Admin Settings Tab — vocabulary composition
//
// The tab loads the settings on mount and renders every vocabulary key as a field under its group heading, in
// order. What this guards: a key added to the vocabulary but not the presentation map silently doesn't render
// (the safe failure), while the known keys always do; and a failed load shows the retry state, not a blank page.
//----------------------------------------------------------------------------------------------------------------------

import { type Mock, beforeEach, describe, expect, it, vi } from 'vitest';
import { type VueWrapper, flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';

import type { AdminSettingEntry, AdminSettingsResponse } from '@fileshed/core';

// Resource Access
import { fetchAdminSettings } from '@client/resource-access/admin.ts';

// Components
import SettingField from '@client/components/admin/settingField.vue';

// Under test
import SettingsTab from '@client/pages/admin/settingsTab.vue';

//----------------------------------------------------------------------------------------------------------------------

vi.mock('@client/resource-access/admin.ts', () => ({
    fetchAdminSettings: vi.fn(),
    patchAdminSettings: vi.fn(),
}));
vi.mock('@nuxt/ui/composables', () => ({ useToast: () => ({ add: vi.fn() }) }));

const fetchMock = fetchAdminSettings as unknown as Mock;

//----------------------------------------------------------------------------------------------------------------------

function fullView() : AdminSettingsResponse
{
    const base = { secret: false, requiresRestart: false, source: 'default' as const };

    const settings : AdminSettingEntry[] = [
        { key: 'UPLOAD_MAX_BYTES', kind: 'number', value: 5_000_000_000, ...base },
        { key: 'AVATAR_MAX_BYTES', kind: 'number', value: 2_000_000, ...base },
        { key: 'DEFAULT_QUOTA_BYTES', kind: 'number', value: 0, ...base },
        { key: 'TRASH_PURGE_DAYS', kind: 'number', value: 30, ...base },
        { key: 'GC_GRACE_DAYS', kind: 'number', value: 7, ...base },
        { key: 'SIGN_UP_ENABLED', kind: 'boolean', value: true, ...base },
    ];

    return { settings, restartRequired: false };
}

function mountTab() : VueWrapper
{
    return mount(SettingsTab, {
        global: {
            stubs: {
                SettingField: true,
                RestartBanner: true,
                UAlert: { name: 'UAlert', props: [ 'title' ], template: '<div class="alert">{{ title }}</div>' },
            },
        },
    });
}

//----------------------------------------------------------------------------------------------------------------------

describe('Admin SettingsTab', () =>
{
    beforeEach(() =>
    {
        setActivePinia(createPinia());
        vi.clearAllMocks();
    });

    it('loads on mount and renders every vocabulary key under its group heading', async () =>
    {
        fetchMock.mockResolvedValue(fullView());
        const wrapper = mountTab();
        await flushPromises();

        expect(wrapper.findAll('h2').map((heading) => heading.text()))
            .toEqual([ 'Registration', 'Limits', 'Retention' ]);

        const keys = wrapper.findAllComponents(SettingField).map((field) => field.props('entry').key);
        expect(keys).toEqual([
            'SIGN_UP_ENABLED',
            'UPLOAD_MAX_BYTES',
            'AVATAR_MAX_BYTES',
            'DEFAULT_QUOTA_BYTES',
            'TRASH_PURGE_DAYS',
            'GC_GRACE_DAYS',
        ]);
    });

    // Zero is a sentinel only on the quota key, where it means unlimited; the other byte keys would be describing a
    // cap of nothing, so they get no word for it.
    it('names the quota key\'s meaning for zero, and only that key\'s', async () =>
    {
        fetchMock.mockResolvedValue(fullView());
        const wrapper = mountTab();
        await flushPromises();

        const labels = new Map(wrapper.findAllComponents(SettingField)
            .map((field) => [ field.props('entry').key, field.props('zeroLabel') ]));

        expect(labels.get('DEFAULT_QUOTA_BYTES')).toBe('Unlimited');
        expect(labels.get('UPLOAD_MAX_BYTES')).toBeUndefined();
        expect(labels.get('AVATAR_MAX_BYTES')).toBeUndefined();
    });

    // Lowering a retention is the moment someone wants it applied, so the sweep that applies it is offered on the
    // card that changed. Only the two retention keys govern a sweep; nothing else claims to.
    it('attaches each retention setting to the sweep that enforces it, and no other setting', async () =>
    {
        fetchMock.mockResolvedValue(fullView());
        const wrapper = mountTab();
        await flushPromises();

        const sweeps = new Map(wrapper.findAllComponents(SettingField)
            .map((field) => [ field.props('entry').key, field.props('sweep')?.kind ]));

        expect(sweeps.get('TRASH_PURGE_DAYS')).toBe('trashPurge');
        expect(sweeps.get('GC_GRACE_DAYS')).toBe('gc');

        expect(sweeps.get('UPLOAD_MAX_BYTES')).toBeUndefined();
        expect(sweeps.get('DEFAULT_QUOTA_BYTES')).toBeUndefined();
        expect(sweeps.get('SIGN_UP_ENABLED')).toBeUndefined();
    });

    it('shows the retry state when the load fails', async () =>
    {
        fetchMock.mockRejectedValue(new Error('offline'));
        const wrapper = mountTab();
        await flushPromises();

        expect(wrapper.find('.alert').text()).toContain('Couldn\'t load the instance settings.');
        expect(wrapper.findAllComponents(SettingField)).toHaveLength(0);
    });
});

//----------------------------------------------------------------------------------------------------------------------
