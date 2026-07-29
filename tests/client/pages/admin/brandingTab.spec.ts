//----------------------------------------------------------------------------------------------------------------------
// Admin Branding Tab — sections, draft, and the save bar
//
// The tab renders the identity field from the settings vocabulary and every theme section; the save bar exists
// ONLY while the draft differs from the saved document; and leaving the tab reverts the draft so a half-tuned
// preview never lingers over the rest of the app.
//----------------------------------------------------------------------------------------------------------------------

import { type Mock, beforeEach, describe, expect, it, vi } from 'vitest';
import { type VueWrapper, flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';

import { type AdminSettingEntry, defaultInstanceTheme, settingDefinitions } from '@fileshed/core';

// Resource Access
import { fetchAdminSettings, fetchBranding } from '@client/resource-access/admin.ts';

// Stores
import { useAdminBrandingStore } from '@client/stores/adminBranding.ts';

// Under test
import BrandingTab from '@client/pages/admin/brandingTab.vue';

//----------------------------------------------------------------------------------------------------------------------

vi.mock('@client/resource-access/admin.ts', () => ({
    fetchAdminSettings: vi.fn(),
    patchAdminSettings: vi.fn(),
    fetchBranding: vi.fn(),
    patchBranding: vi.fn(),
}));
vi.mock('@nuxt/ui/composables', () => ({ useToast: () => ({ add: vi.fn() }) }));

const settingsMock = fetchAdminSettings as unknown as Mock;
const brandingMock = fetchBranding as unknown as Mock;

function settingsView() : { settings : AdminSettingEntry[]; restartRequired : boolean }
{
    const settings = Object.values(settingDefinitions).map((definition) : AdminSettingEntry => ({
        key: definition.key,
        kind: definition.kind,
        secret: definition.secret,
        requiresRestart: definition.requiresRestart,
        value: typeof definition.fallback === 'boolean' ? definition.fallback : null,
        source: 'default',
        hasDefault: definition.fallback !== null,
    }));

    return { settings, restartRequired: false };
}

function mountTab() : VueWrapper
{
    return mount(BrandingTab, {
        global: {
            stubs: {
                SettingField: { name: 'SettingField', props: [ 'entry' ], template: '<div class="setting-field" />' },
                LogoField: true,
                BrandColorField: true,
                NeutralField: true,
                RadiusField: true,
                ModeField: true,
                CustomCssField: true,
                UAlert: { name: 'UAlert', props: [ 'title' ], template: '<div class="alert">{{ title }}</div>' },
                UButton: { name: 'UButton', props: [ 'label' ], template: '<button>{{ label }}</button>' },
                UFieldGroup: { template: '<div><slot /></div>' },
                UTooltip: { template: '<div><slot /></div>' },
                teleport: true,
            },
        },
    });
}

//----------------------------------------------------------------------------------------------------------------------

describe('Admin BrandingTab', () =>
{
    beforeEach(() =>
    {
        setActivePinia(createPinia());
        vi.clearAllMocks();
        document.documentElement.removeAttribute('style');
        document.documentElement.classList.remove('dark');
    });

    it('renders the identity field and every theme section, with no save bar while clean', async () =>
    {
        settingsMock.mockResolvedValue(settingsView());
        brandingMock.mockResolvedValue({ ...defaultInstanceTheme });
        const wrapper = mountTab();
        await flushPromises();

        expect(wrapper.find('.setting-field').exists()).toBe(true);
        expect(wrapper.findComponent({ name: 'LogoField' }).exists()).toBe(true);
        expect(wrapper.findComponent({ name: 'BrandColorField' }).exists()).toBe(true);
        expect(wrapper.findComponent({ name: 'NeutralField' }).exists()).toBe(true);
        expect(wrapper.findComponent({ name: 'RadiusField' }).exists()).toBe(true);
        expect(wrapper.findComponent({ name: 'ModeField' }).exists()).toBe(true);
        expect(wrapper.findComponent({ name: 'CustomCssField' }).exists()).toBe(true);
        expect(wrapper.find('[data-testid="save-bar"]').exists()).toBe(false);
    });

    it('raises the save bar when the draft dirties and drops it on revert', async () =>
    {
        settingsMock.mockResolvedValue(settingsView());
        brandingMock.mockResolvedValue({ ...defaultInstanceTheme });
        const wrapper = mountTab();
        await flushPromises();

        const branding = useAdminBrandingStore();
        branding.setKnob({ primary: '#3b82f6' });
        await flushPromises();
        expect(wrapper.find('[data-testid="save-bar"]').exists()).toBe(true);

        branding.revert();
        await flushPromises();
        expect(wrapper.find('[data-testid="save-bar"]').exists()).toBe(false);
    });

    it('flips only the dark class for the mode preview -- nothing stored, nothing persisted', async () =>
    {
        settingsMock.mockResolvedValue(settingsView());
        brandingMock.mockResolvedValue({ ...defaultInstanceTheme });
        const wrapper = mountTab();
        await flushPromises();

        const dark = wrapper.findAll('button').find((button) => button.text() === 'Dark');
        await dark?.trigger('click');
        expect(document.documentElement.classList.contains('dark')).toBe(true);

        const light = wrapper.findAll('button').find((button) => button.text() === 'Light');
        await light?.trigger('click');
        expect(document.documentElement.classList.contains('dark')).toBe(false);
    });

    it('reverts the draft AND the mode preview when the tab unmounts', async () =>
    {
        settingsMock.mockResolvedValue(settingsView());
        brandingMock.mockResolvedValue({ ...defaultInstanceTheme });
        const wrapper = mountTab();
        await flushPromises();

        const branding = useAdminBrandingStore();
        branding.setKnob({ radius: 0.75 });
        expect(document.documentElement.style.getPropertyValue('--ui-radius')).toBe('0.75rem');

        const dark = wrapper.findAll('button').find((button) => button.text() === 'Dark');
        await dark?.trigger('click');
        expect(document.documentElement.classList.contains('dark')).toBe(true);

        wrapper.unmount();

        expect(branding.dirty).toBe(false);
        expect(document.documentElement.style.getPropertyValue('--ui-radius')).toBe('');

        // No branding facts and no user choice resolve to system; with no OS signal in this environment, light.
        expect(document.documentElement.classList.contains('dark')).toBe(false);
    });

    it('shows the retry state when a load fails', async () =>
    {
        settingsMock.mockResolvedValue(settingsView());
        brandingMock.mockRejectedValue(new Error('offline'));
        const wrapper = mountTab();
        await flushPromises();

        expect(wrapper.find('.alert').text()).toContain('Couldn\'t load the branding.');
    });
});

//----------------------------------------------------------------------------------------------------------------------
