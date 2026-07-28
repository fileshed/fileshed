//----------------------------------------------------------------------------------------------------------------------
// Admin Status Tab — the operational glance
//
// The tab reports what the server answers: each storage backend with the default one badged, and the latest sweep
// runs -- a sweep that has never run says so instead of faking a timestamp. The restart banner rides the settings
// store, which the tab loads alongside the status so a fresh landing here still knows a restart is pending.
//----------------------------------------------------------------------------------------------------------------------

import { type Mock, beforeEach, describe, expect, it, vi } from 'vitest';
import { type VueWrapper, flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';

import type { AdminStatusResponse } from '@fileshed/core';

// Resource Access
import { adminStatus, fetchAdminSettings } from '@client/resource-access/admin.ts';

// Under test
import StatusTab from '@client/pages/admin/statusTab.vue';

//----------------------------------------------------------------------------------------------------------------------

vi.mock('@client/resource-access/admin.ts', () => ({
    adminStatus: vi.fn(),
    fetchAdminSettings: vi.fn(),
    patchAdminSettings: vi.fn(),
}));
vi.mock('@nuxt/ui/composables', () => ({ useToast: () => ({ add: vi.fn() }) }));

const statusMock = adminStatus as unknown as Mock;
const settingsMock = fetchAdminSettings as unknown as Mock;

//----------------------------------------------------------------------------------------------------------------------

function statusFixture(overrides : Partial<AdminStatusResponse> = {}) : AdminStatusResponse
{
    return {
        backends: [
            { id: 'backend_1', kind: 'filesystem', isDefault: true },
        ],
        gc: {
            ranAt: '2026-07-28T10:00:00.000Z',
            summary: { candidates: 4, deleted: 3, kept: 1, bytesFailed: 0 },
        },
        trashPurge: null,
        ...overrides,
    };
}

function mountTab() : VueWrapper
{
    return mount(StatusTab, {
        global: {
            stubs: {
                UAlert: {
                    name: 'UAlert',
                    props: [ 'title', 'description' ],
                    template: '<div class="alert">{{ title }}</div>',
                },
                UIcon: true,
                UBadge: { name: 'UBadge', props: [ 'label' ], template: '<span class="badge">{{ label }}</span>' },
            },
        },
    });
}

//----------------------------------------------------------------------------------------------------------------------

describe('Admin StatusTab', () =>
{
    beforeEach(() =>
    {
        setActivePinia(createPinia());
        vi.clearAllMocks();
        settingsMock.mockResolvedValue({ settings: [], restartRequired: false });
    });

    it('lists each backend, badging the default, and reports the sweep summaries', async () =>
    {
        statusMock.mockResolvedValue(statusFixture());
        const wrapper = mountTab();
        await flushPromises();

        expect(wrapper.text()).toContain('filesystem');
        expect(wrapper.find('.badge').text()).toBe('Default');
        expect(wrapper.text()).toContain('4 candidates');
        expect(wrapper.text()).toContain('3 deleted');
    });

    it('says a sweep has not run yet instead of faking a timestamp', async () =>
    {
        statusMock.mockResolvedValue(statusFixture({ gc: null, trashPurge: null }));
        const wrapper = mountTab();
        await flushPromises();

        expect(wrapper.text()).toContain('Not run yet');
    });

    it('raises the restart banner when the settings store says one is pending', async () =>
    {
        statusMock.mockResolvedValue(statusFixture());
        settingsMock.mockResolvedValue({ settings: [], restartRequired: true });
        const wrapper = mountTab();
        await flushPromises();

        expect(wrapper.text()).toContain('Restart required');
    });

    it('shows the retry state when the status load fails', async () =>
    {
        statusMock.mockRejectedValue(new Error('offline'));
        const wrapper = mountTab();
        await flushPromises();

        expect(wrapper.find('.alert').text()).toContain('Couldn\'t load the server status.');
    });
});

//----------------------------------------------------------------------------------------------------------------------
