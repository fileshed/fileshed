//----------------------------------------------------------------------------------------------------------------------
// Admin User Row — badges and the actions menu
//
// The row badges what the account is (role, ban state with the reason as the tooltip) and offers the management
// menu. The menu adapts to the row: a banned account offers Unban instead of Ban, an admin offers Demote instead of
// Promote -- and the self-directed footguns (banning yourself, demoting yourself) are disabled for the signed-in
// admin's own row, mirroring the server's refusals.
//
// The quota column reports the enforced cap the row arrives with, and reads the raw per-user limit only to mark an
// inheriting account as riding the instance default.
//----------------------------------------------------------------------------------------------------------------------

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { type VueWrapper, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';

import { type AdminUserResponse, type MeResponse, UNLIMITED_QUOTA } from '@fileshed/core';

// Stores
import { useSessionStore } from '@client/stores/session.ts';

// Under test
import UserRow from '@client/components/admin/userRow.vue';

//----------------------------------------------------------------------------------------------------------------------

vi.mock('@nuxt/ui/composables', () => ({ useToast: () => ({ add: vi.fn() }) }));

//----------------------------------------------------------------------------------------------------------------------

function user(overrides : Partial<AdminUserResponse> = {}) : AdminUserResponse
{
    return {
        id: 'u1',
        email: 'member@example.com',
        name: 'Member',
        role: 'user',
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

function meFixture(id : string) : MeResponse
{
    return {
        id,
        email: 'admin@example.com',
        role: 'admin',
        quota: { used: 0, effective: null, limit: null },
        limits: { trashRetentionDays: 30 },
        preferences: {},
        createdAt: '2026-07-01T00:00:00.000Z',
    };
}

interface MenuEntry { label : string; disabled ?: boolean }

// The dropdown stub exposes the item groups it received, so specs assert the menu's shape without Nuxt UI runtime.
const UDropdownMenuStub = {
    name: 'UDropdownMenu',
    props: [ 'items' ],
    template: '<div class="menu"><slot /></div>',
};

function mountRow(target : AdminUserResponse) : VueWrapper
{
    return mount(UserRow, {
        props: { user: target },
        global: {
            stubs: {
                UDropdownMenu: UDropdownMenuStub,
                UBadge: { name: 'UBadge', props: [ 'label' ], template: '<span class="badge">{{ label }}</span>' },
                UButton: true,
            },
        },
    });
}

function menuLabels(wrapper : VueWrapper) : MenuEntry[]
{
    const items = wrapper.findComponent(UDropdownMenuStub).props('items') as MenuEntry[][];
    return items.flat().map(({ label, disabled }) => ({ label, ...disabled === undefined ? {} : { disabled } }));
}

//----------------------------------------------------------------------------------------------------------------------

describe('UserRow', () =>
{
    beforeEach(() =>
    {
        setActivePinia(createPinia());
        useSessionStore().me = meFixture('admin1');
    });

    it('badges the ban with the until date and carries the reason as the tooltip', () =>
    {
        const wrapper = mountRow(user({
            banned: true,
            banReason: 'Spamming',
            banExpires: '2026-08-04T00:00:00.000Z',
        }));

        const badges = wrapper.findAll('.badge').map((badge) => badge.text());
        expect(badges[0]).toBe('user');
        expect(badges[1]).toMatch(/^Banned until /);
        expect(wrapper.findAll('.badge')[1]?.attributes('title')).toBe('Spamming');
    });

    it('shows the usage percentage only for capped accounts, warning-colored from 80%', () =>
    {
        const uncapped = mountRow(user({ usedBytes: 4096, quotaEffective: null }));
        expect(uncapped.text()).not.toContain('%');

        const comfortable = mountRow(user({ usedBytes: 4500, quotaLimit: 10_000, quotaEffective: 10_000 }));
        expect(comfortable.text()).toContain('(45%)');
        expect(comfortable.find('.text-error').exists()).toBe(false);

        const nearing = mountRow(user({ usedBytes: 8500, quotaLimit: 10_000, quotaEffective: 10_000 }));
        expect(nearing.text()).toContain('(85%)');
        expect(nearing.find('.text-error').text()).toContain('85%');
    });

    it('reports the enforced cap, marked as the default, for an account with no limit of its own', () =>
    {
        const wrapper = mountRow(user({ usedBytes: 4500, quotaLimit: null, quotaEffective: 10_000 }));

        expect(wrapper.text()).toContain('10 kB');
        expect(wrapper.text()).toContain('(default)');
        expect(wrapper.text()).toContain('(45%)');
    });

    it('reports an account pinned unlimited as unlimited, unmarked', () =>
    {
        const wrapper = mountRow(user({ usedBytes: 4500, quotaLimit: UNLIMITED_QUOTA, quotaEffective: null }));

        expect(wrapper.text()).toContain('Unlimited');
        expect(wrapper.text()).not.toContain('(default)');
        expect(wrapper.text()).not.toContain('%');
    });

    it('marks an inheriting account unlimited when the enforced cap is itself unlimited', () =>
    {
        const wrapper = mountRow(user({ usedBytes: 4500, quotaLimit: null, quotaEffective: null }));

        expect(wrapper.text()).toContain('Unlimited');
        expect(wrapper.text()).toContain('(default)');
    });

    it('leaves an explicit cap of its own unmarked', () =>
    {
        const wrapper = mountRow(user({ usedBytes: 4500, quotaLimit: 20_000, quotaEffective: 20_000 }));

        expect(wrapper.text()).toContain('20 kB');
        expect(wrapper.text()).not.toContain('(default)');
    });

    it('offers Promote for a user and Demote for an admin', () =>
    {
        expect(menuLabels(mountRow(user())).map((entry) => entry.label)).toContain('Promote to admin');
        expect(menuLabels(mountRow(user({ role: 'admin' }))).map((entry) => entry.label)).toContain('Demote to user');
    });

    it('offers Unban for a banned account instead of Ban', () =>
    {
        const labels = menuLabels(mountRow(user({ banned: true }))).map((entry) => entry.label);

        expect(labels).toContain('Unban');
        expect(labels).not.toContain('Ban…');
    });

    it('disables self-ban and self-demotion on the signed-in admin\'s own row', () =>
    {
        const labels = menuLabels(mountRow(user({ id: 'admin1', role: 'admin' })));

        expect(labels.find((entry) => entry.label === 'Demote to user')?.disabled).toBe(true);
        expect(labels.find((entry) => entry.label === 'Ban…')?.disabled).toBe(true);
    });

    it('leaves ban and demote live on someone else\'s row', () =>
    {
        const labels = menuLabels(mountRow(user({ id: 'other', role: 'admin' })));

        expect(labels.find((entry) => entry.label === 'Demote to user')?.disabled).toBe(false);
        expect(labels.find((entry) => entry.label === 'Ban…')?.disabled).toBe(false);
    });
});

//----------------------------------------------------------------------------------------------------------------------
