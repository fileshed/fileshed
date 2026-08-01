//----------------------------------------------------------------------------------------------------------------------
// Admin Overview Tab — the operational glance
//
// The tab reports what the server answers and nothing it does not: the headline figures, the dedup saving only when
// there are logical bytes to compare against, each storage backend with the default one badged, and the latest sweep
// runs -- a sweep that has never run says so instead of faking a timestamp. The restart banner rides the settings
// store, which the tab loads alongside the status so a fresh landing here still knows a restart is pending.
//----------------------------------------------------------------------------------------------------------------------

import { type Mock, beforeEach, describe, expect, it, vi } from 'vitest';
import { type VueWrapper, flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';

import type { AdminOverview, AdminStatusResponse } from '@fileshed/core';

// Resource Access
import { adminStatus, fetchAdminSettings } from '@client/resource-access/admin.ts';

// Under test
import OverviewTab from '@client/pages/admin/overviewTab.vue';

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

function overviewFixture(overrides : Partial<AdminOverview> = {}) : AdminOverview
{
    return {
        users: { total: 12, admins: 2, banned: 1, newThisWeek: 3 },
        nodes: { files: 480, folders: 37 },
        storage: {
            logicalBytes: 4_000_000,
            physicalBytes: 3_000_000,
            graveyardBytes: 250_000,
            graveyardCount: 6,
        },
        trash: { count: 4, bytes: 900_000 },
        accessRequestsPending: 2,
        instance: {
            version: '1.4.2',
            databaseKind: 'postgres',
            uptimeSeconds: (5 * 86_400) + (3 * 3600),
            emailEnabled: true,
            activeProviders: 3,
            signUpEnabled: false,
        },
        ...overrides,
    };
}

function statusFixture(overrides : Partial<AdminStatusResponse> = {}) : AdminStatusResponse
{
    return {
        overview: overviewFixture(),
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
    return mount(OverviewTab, {
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

async function mountWith(status : AdminStatusResponse) : Promise<VueWrapper>
{
    statusMock.mockResolvedValue(status);
    const wrapper = mountTab();
    await flushPromises();

    return wrapper;
}

//----------------------------------------------------------------------------------------------------------------------

describe('Admin OverviewTab', () =>
{
    beforeEach(() =>
    {
        setActivePinia(createPinia());
        vi.clearAllMocks();
        settingsMock.mockResolvedValue({ settings: [], restartRequired: false });
    });

    it('renders the headline counts, with folders under the file count', async () =>
    {
        const wrapper = await mountWith(statusFixture());

        expect(wrapper.text()).toContain('12');
        expect(wrapper.text()).toContain('480');
        expect(wrapper.text()).toContain('37 folders');
        expect(wrapper.text()).toContain('2 admins');
        expect(wrapper.text()).toContain('1 banned');
    });

    it('flags the accounts that arrived this week, and stays silent when none did', async () =>
    {
        const withSignups = await mountWith(statusFixture());

        expect(withSignups.text()).toContain('+3 this week');

        const quiet = await mountWith(statusFixture({
            overview: overviewFixture({ users: { total: 12, admins: 2, banned: 1, newThisWeek: 0 } }),
        }));

        expect(quiet.text()).not.toContain('this week');
    });

    it('renders the byte totals in human units', async () =>
    {
        const wrapper = await mountWith(statusFixture());

        expect(wrapper.text()).toContain('4 MB');
        expect(wrapper.text()).toContain('3 MB');
        expect(wrapper.text()).toContain('250 kB');
        expect(wrapper.text()).toContain('6 blobs awaiting collection');
        expect(wrapper.text()).toContain('900 kB still charged');
    });

    it('measures the stored footprint against what users are charged', async () =>
    {
        const wrapper = await mountWith(statusFixture());

        expect(wrapper.text()).toContain('25% smaller than charged');
    });

    it('measures nothing when the instance holds nothing, rather than claiming a full saving', async () =>
    {
        const wrapper = await mountWith(statusFixture({
            overview: overviewFixture({
                storage: { logicalBytes: 0, physicalBytes: 0, graveyardBytes: 0, graveyardCount: 0 },
            }),
        }));

        expect(wrapper.text()).not.toContain('smaller than charged');
    });

    it('reports what this deployment is: build, dialect, uptime, and the switches', async () =>
    {
        const wrapper = await mountWith(statusFixture());

        expect(wrapper.text()).toContain('1.4.2');
        expect(wrapper.text()).toContain('PostgreSQL');
        expect(wrapper.text()).toContain('5d 3h');
        expect(wrapper.text()).toContain('Configured');
        expect(wrapper.text()).toContain('Closed');
    });

    it('lists each backend, badging the default, and reports the sweep summaries', async () =>
    {
        const wrapper = await mountWith(statusFixture());

        expect(wrapper.text()).toContain('filesystem');
        expect(wrapper.find('.badge').text()).toBe('Default');
        expect(wrapper.text()).toContain('4 candidates');
        expect(wrapper.text()).toContain('3 deleted');
    });

    it('says a sweep has not run yet instead of faking a timestamp', async () =>
    {
        const wrapper = await mountWith(statusFixture({ gc: null, trashPurge: null }));

        expect(wrapper.text()).toContain('Not run yet');
    });

    it('raises the restart banner when the settings store says one is pending', async () =>
    {
        settingsMock.mockResolvedValue({ settings: [], restartRequired: true });
        const wrapper = await mountWith(statusFixture());

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
