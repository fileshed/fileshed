//----------------------------------------------------------------------------------------------------------------------
// User Menu — the theme quick toggle
//
// The menu offers the three-mode theme picker exactly when the instance is not forcing a mode: picking one
// persists through the preferences blob and paints optimistically, the active mode carries the check, and a
// forced instance hides the group entirely -- same honesty rule as the account control.
//----------------------------------------------------------------------------------------------------------------------

import { type Mock, beforeEach, describe, expect, it, vi } from 'vitest';
import { type VueWrapper, flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import type { DropdownMenuItem } from '@nuxt/ui';

// Resource Access
import { updatePreferences } from '@client/resource-access/preferences.ts';

// Stores
import { useAppStore } from '@client/stores/app.ts';
import { useSessionStore } from '@client/stores/session.ts';

// Support
import { meFixture } from '../../support.ts';

// Under test
import UserMenu from '@client/components/layout/userMenu.vue';

//----------------------------------------------------------------------------------------------------------------------

vi.mock('@client/resource-access/preferences.ts', () => ({ updatePreferences: vi.fn() }));
vi.mock('@client/resource-access/instance.ts', () => ({ fetchInstance: vi.fn() }));
vi.mock('@nuxt/ui/composables', () => ({ useToast: () => ({ add: vi.fn() }) }));
vi.mock('vue-router', () => ({ useRouter: () => ({ push: vi.fn() }) }));

const updatePreferencesMock = updatePreferences as unknown as Mock;

//----------------------------------------------------------------------------------------------------------------------

const UDropdownMenuStub = {
    name: 'UDropdownMenu',
    props: [ 'items' ],
    template: '<div><slot /></div>',
};

function mountMenu() : VueWrapper
{
    return mount(UserMenu, {
        global: {
            stubs: {
                UDropdownMenu: UDropdownMenuStub,
                UButton: { template: '<button><slot /></button>' },
                UAvatar: true,
            },
        },
    });
}

function themeGroup(wrapper : VueWrapper) : DropdownMenuItem | undefined
{
    const items = wrapper.findComponent({ name: 'UDropdownMenu' }).props('items') as DropdownMenuItem[][];

    return items.flat().find((item) => item.label === 'Theme');
}

//----------------------------------------------------------------------------------------------------------------------

describe('UserMenu theme toggle', () =>
{
    beforeEach(() =>
    {
        setActivePinia(createPinia());
        vi.clearAllMocks();
    });

    it('offers the three modes with the active one checked, above the Account entry', () =>
    {
        const session = useSessionStore();
        session.me = meFixture({ preferences: { colorMode: 'dark' } });

        const wrapper = mountMenu();
        const theme = themeGroup(wrapper);
        const children = (theme?.children ?? []) as DropdownMenuItem[];

        expect(children.map((child) => child.label)).toEqual([ 'System', 'Light', 'Dark' ]);
        expect(children.map((child) => child.checked)).toEqual([ false, false, true ]);

        const labels = (wrapper.findComponent({ name: 'UDropdownMenu' }).props('items') as DropdownMenuItem[][])
            .flat()
            .map((item) => item.label);
        expect(labels.indexOf('Theme')).toBeLessThan(labels.indexOf('Account'));
    });

    it('persists a picked mode through the preferences blob, painting it optimistically', async () =>
    {
        const session = useSessionStore();
        session.me = meFixture();
        updatePreferencesMock.mockResolvedValue(meFixture({ preferences: { colorMode: 'light' } }));

        const theme = themeGroup(mountMenu());
        const children = (theme?.children ?? []) as DropdownMenuItem[];
        children[1]?.onSelect?.(new Event('select'));

        expect(session.colorMode).toBe('light');

        await flushPromises();
        expect(updatePreferencesMock).toHaveBeenCalledWith({ colorMode: 'light' });
    });

    it('hides the group entirely when the instance forces a mode', () =>
    {
        const session = useSessionStore();
        session.me = meFixture();
        const app = useAppStore();
        app.branding = { instanceName: 'FileShed', mode: 'dark', forcedMode: true, logo: null };

        expect(themeGroup(mountMenu())).toBeUndefined();
    });
});

//----------------------------------------------------------------------------------------------------------------------
