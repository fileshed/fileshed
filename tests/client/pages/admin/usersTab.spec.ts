//----------------------------------------------------------------------------------------------------------------------
// Admin Users Tab — the accounts listing
//
// The tab lists every account with the facts an operator scans for: identity, role badged, quota as a size or
// Unlimited, and the total count. A failed load shows the retry state, not an empty table pretending the instance
// has no users.
//----------------------------------------------------------------------------------------------------------------------

import { type Mock, beforeEach, describe, expect, it, vi } from 'vitest';
import { type VueWrapper, flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';

import type { AdminUserPageResponse } from '@fileshed/core';

// Resource Access
import { listUsers } from '@client/resource-access/admin.ts';

// Under test
import UsersTab from '@client/pages/admin/usersTab.vue';

//----------------------------------------------------------------------------------------------------------------------

vi.mock('@client/resource-access/admin.ts', () => ({ listUsers: vi.fn() }));
vi.mock('@nuxt/ui/composables', () => ({ useToast: () => ({ add: vi.fn() }) }));

const listUsersMock = listUsers as unknown as Mock;

//----------------------------------------------------------------------------------------------------------------------

function pageFixture() : AdminUserPageResponse
{
    return {
        users: [
            {
                id: 'u1',
                email: 'root@example.com',
                name: 'Root',
                role: 'admin',
                quotaLimit: null,
                createdAt: '2026-07-01T00:00:00.000Z',
            },
            {
                id: 'u2',
                email: 'member@example.com',
                name: 'Member',
                role: 'user',
                quotaLimit: 5_000_000_000,
                createdAt: '2026-07-02T00:00:00.000Z',
            },
        ],
        total: 2,
        limit: 100,
        offset: 0,
    };
}

function mountTab() : VueWrapper
{
    return mount(UsersTab, {
        global: {
            stubs: {
                UAlert: { name: 'UAlert', props: [ 'title' ], template: '<div class="alert">{{ title }}</div>' },
                UBadge: { name: 'UBadge', props: [ 'label' ], template: '<span class="badge">{{ label }}</span>' },
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

    it('lists every account with role badge, quota, and the total', async () =>
    {
        listUsersMock.mockResolvedValue(pageFixture());
        const wrapper = mountTab();
        await flushPromises();

        expect(wrapper.text()).toContain('root@example.com');
        expect(wrapper.text()).toContain('member@example.com');
        expect(wrapper.findAll('.badge').map((badge) => badge.text())).toEqual([ 'admin', 'user' ]);
        expect(wrapper.text()).toContain('Unlimited');
        expect(wrapper.text()).toContain('5 GB');
        expect(wrapper.text()).toContain('2 accounts');
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
