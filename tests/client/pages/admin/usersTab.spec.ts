//----------------------------------------------------------------------------------------------------------------------
// Admin Users Tab — the accounts listing and its management actions
//
// The tab lists every account with the facts an operator scans for: identity, role and ban state badged, charged
// usage, quota, and the total. Typing in the search box re-queries (debounced) with the chosen field; toggling a
// sortable header cycles asc -> desc -> unsorted; and an action that answers a refreshed row merges it in place
// without refetching the page. A failed load shows the retry state, not an empty table pretending the instance has
// no users. The one thing the tab wants from the instance settings is the default quota its set-quota modal names,
// so landing here asks for them only when the store has none.
//----------------------------------------------------------------------------------------------------------------------

import { type Mock, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type VueWrapper, flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';

import type { AdminSettingsResponse, AdminUserPageResponse, AdminUserResponse } from '@fileshed/core';

// Resource Access
import { fetchAdminSettings, listUsers, setUserRole } from '@client/resource-access/admin.ts';

// Stores
import { useAdminSettingsStore } from '@client/stores/adminSettings.ts';

// Components
import UserRow from '@client/components/admin/userRow.vue';

// Under test
import UsersTab from '@client/pages/admin/usersTab.vue';

//----------------------------------------------------------------------------------------------------------------------

vi.mock('@client/resource-access/admin.ts', () => ({
    listUsers: vi.fn(),
    setQuota: vi.fn(),
    banUser: vi.fn(),
    unbanUser: vi.fn(),
    setUserRole: vi.fn(),
    setUserPassword: vi.fn(),
    revokeUserSessions: vi.fn(),
    fetchAdminSettings: vi.fn(),
    patchAdminSettings: vi.fn(),
}));
vi.mock('@nuxt/ui/composables', () => ({ useToast: () => ({ add: vi.fn() }) }));

const listUsersMock = listUsers as unknown as Mock;
const setUserRoleMock = setUserRole as unknown as Mock;
const fetchSettingsMock = fetchAdminSettings as unknown as Mock;

//----------------------------------------------------------------------------------------------------------------------

function row(overrides : Partial<AdminUserResponse> = {}) : AdminUserResponse
{
    return {
        id: 'u1',
        email: 'root@example.com',
        name: 'Root',
        role: 'admin',
        quotaLimit: null,
        quotaEffective: null,
        banned: false,
        banReason: null,
        banExpires: null,
        usedBytes: 0,
        createdAt: '2026-07-01T00:00:00.000Z',
        ...overrides,
    };
}

function pageFixture(users : AdminUserResponse[]) : AdminUserPageResponse
{
    return { users, total: users.length, limit: 100, offset: 0 };
}

function settingsView(defaultQuota : number) : AdminSettingsResponse
{
    return {
        settings: [
            {
                hasDefault: true,
                key: 'DEFAULT_QUOTA_BYTES',
                kind: 'number',
                secret: false,
                requiresRestart: false,
                value: defaultQuota,
                source: 'override',
            },
        ],
        restartRequired: false,
    };
}

const SetQuotaModalStub = { name: 'SetQuotaModal', props: [ 'defaultQuota' ], template: '<div class="quota" />' };

function quotaModalDefault(wrapper : VueWrapper) : number
{
    return wrapper.findComponent(SetQuotaModalStub).props('defaultQuota') as number;
}

function mountTab() : VueWrapper
{
    return mount(UsersTab, {
        global: {
            stubs: {
                UAlert: { name: 'UAlert', props: [ 'title' ], template: '<div class="alert">{{ title }}</div>' },
                UBadge: { name: 'UBadge', props: [ 'label' ], template: '<span class="badge">{{ label }}</span>' },
                UInput: {
                    name: 'UInput',
                    props: [ 'modelValue' ],
                    emits: [ 'update:modelValue' ],
                    template: '<input class="search-input" :value="modelValue" '
                        + '@input="$emit(\'update:modelValue\', $event.target.value)" />',
                },
                USelect: true,
                UDropdownMenu: true,
                UButton: true,
                UIcon: true,
                SetQuotaModal: SetQuotaModalStub,
                SetPasswordModal: true,
                BanUserModal: true,
            },
        },
    });
}

//----------------------------------------------------------------------------------------------------------------------

describe('Admin UsersTab', () =>
{
    beforeEach(() =>
    {
        setActivePinia(createPinia());
        vi.clearAllMocks();
    });

    afterEach(() =>
    {
        vi.useRealTimers();
    });

    it('lists accounts with ban state, usage, quota, and the total', async () =>
    {
        listUsersMock.mockResolvedValue(pageFixture([
            row(),
            row({
                id: 'u2',
                email: 'member@example.com',
                name: 'Member',
                role: 'user',
                quotaLimit: 5_000_000_000,
                quotaEffective: 5_000_000_000,
                usedBytes: 1_500_000,
                banned: true,
                banReason: 'Spamming',
            }),
        ]));
        const wrapper = mountTab();
        await flushPromises();

        expect(wrapper.text()).toContain('root@example.com');
        expect(wrapper.text()).toContain('member@example.com');
        expect(wrapper.findAll('.badge').map((badge) => badge.text()))
            .toEqual([ 'admin', 'user', 'Banned' ]);
        expect(wrapper.text()).toContain('Unlimited');
        expect(wrapper.text()).toContain('5 GB');
        expect(wrapper.text()).toContain('1.5 MB');
        expect(wrapper.text()).toContain('2 accounts');
    });

    it('re-queries with the trimmed search and chosen field after the typing settles', async () =>
    {
        vi.useFakeTimers();
        listUsersMock.mockResolvedValue(pageFixture([ row() ]));
        const wrapper = mountTab();
        await flushPromises();
        listUsersMock.mockClear();

        await wrapper.find('.search-input').setValue('  member  ');
        expect(listUsersMock).not.toHaveBeenCalled();

        vi.advanceTimersByTime(350);
        expect(listUsersMock).toHaveBeenCalledWith(
            expect.objectContaining({ search: 'member', searchField: 'email' })
        );
    });

    it('cycles a sortable header asc, desc, then unsorted', async () =>
    {
        listUsersMock.mockResolvedValue(pageFixture([ row() ]));
        const wrapper = mountTab();
        await flushPromises();
        listUsersMock.mockClear();

        const joined = wrapper.findAll('button').filter((button) => button.text().includes('Joined'))[0];
        if(joined === undefined) { throw new Error('Joined header not rendered'); }

        await joined.trigger('click');
        await flushPromises();
        expect(listUsersMock).toHaveBeenLastCalledWith(
            expect.objectContaining({ sortBy: 'createdAt', sortDirection: 'asc' })
        );

        await joined.trigger('click');
        await flushPromises();
        expect(listUsersMock).toHaveBeenLastCalledWith(
            expect.objectContaining({ sortBy: 'createdAt', sortDirection: 'desc' })
        );

        await joined.trigger('click');
        await flushPromises();
        expect(listUsersMock).toHaveBeenLastCalledWith(expect.not.objectContaining({ sortBy: 'createdAt' }));
    });

    it('merges an action\'s refreshed row in place without refetching', async () =>
    {
        listUsersMock.mockResolvedValue(pageFixture([
            row({ id: 'u2', email: 'member@example.com', role: 'user' }),
        ]));
        setUserRoleMock.mockResolvedValue(row({ id: 'u2', email: 'member@example.com', role: 'admin' }));
        const wrapper = mountTab();
        await flushPromises();
        listUsersMock.mockClear();

        const userRow = wrapper.findComponent(UserRow);
        userRow.vm.$emit('promote');
        await flushPromises();

        expect(setUserRoleMock).toHaveBeenCalledWith('u2', 'admin');
        expect(wrapper.findAll('.badge').map((badge) => badge.text())).toEqual([ 'admin' ]);
        expect(listUsersMock).not.toHaveBeenCalled();
    });

    //------------------------------------------------------------------------------------------------------------------
    // The instance default the quota modal names
    //------------------------------------------------------------------------------------------------------------------

    it('costs no settings round trip when the instance default is already in hand', async () =>
    {
        listUsersMock.mockResolvedValue(pageFixture([ row() ]));
        fetchSettingsMock.mockResolvedValue(settingsView(20_000));
        await useAdminSettingsStore().load();
        fetchSettingsMock.mockClear();

        const wrapper = mountTab();
        await flushPromises();

        expect(fetchSettingsMock).not.toHaveBeenCalled();
        expect(quotaModalDefault(wrapper)).toBe(20_000);
    });

    // Without the settings, the modal would call an instance that caps accounts at 20 kB unlimited.
    it('gets the instance default when the settings were never loaded this session', async () =>
    {
        listUsersMock.mockResolvedValue(pageFixture([ row() ]));
        fetchSettingsMock.mockResolvedValue(settingsView(20_000));

        const wrapper = mountTab();
        await flushPromises();

        expect(quotaModalDefault(wrapper)).toBe(20_000);
    });

    it('shows the retry state when the load fails', async () =>
    {
        listUsersMock.mockRejectedValue(new Error('offline'));
        const wrapper = mountTab();
        await flushPromises();

        expect(wrapper.find('.alert').text()).toContain('Couldn\'t load the user list.');
        expect(wrapper.findAll('tbody tr')).toHaveLength(0);
    });
});

//----------------------------------------------------------------------------------------------------------------------
