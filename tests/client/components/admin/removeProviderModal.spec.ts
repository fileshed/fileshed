//----------------------------------------------------------------------------------------------------------------------
// Remove Provider Modal — deleting a provider's stored configuration
//
// Removal is one atomic patch resetting every override the provider owns -- and only overrides: values supplied
// by the deployment configuration are not the modal's to delete, so it explains instead of offering a Remove that
// could not work. Nothing mutates without the explicit confirmation.
//----------------------------------------------------------------------------------------------------------------------

import { type Mock, beforeEach, describe, expect, it, vi } from 'vitest';
import { type DOMWrapper, type VueWrapper, flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';

import { type AdminSettingEntry, type SocialProviderID, settingDefinitions } from '@fileshed/core';

// Stores
import { useAdminSettingsStore } from '@client/stores/adminSettings.ts';

// Resource Access
import { patchAdminSettings } from '@client/resource-access/admin.ts';

// Under test
import RemoveProviderModal from '@client/components/admin/modals/removeProviderModal.vue';

//----------------------------------------------------------------------------------------------------------------------

vi.mock('@client/resource-access/admin.ts', () => ({
    fetchAdminSettings: vi.fn(),
    patchAdminSettings: vi.fn(),
}));
vi.mock('@nuxt/ui/composables', () => ({ useToast: () => ({ add: vi.fn() }) }));

const patchMock = patchAdminSettings as unknown as Mock;

//----------------------------------------------------------------------------------------------------------------------

function entriesWith(
    overrides : Partial<Record<string, string>>,
    fromConfig : Partial<Record<string, string>> = {}
) : AdminSettingEntry[]
{
    return Object.values(settingDefinitions).map((definition) : AdminSettingEntry => ({
        key: definition.key,
        kind: definition.kind,
        secret: definition.secret,
        requiresRestart: definition.requiresRestart,
        value: overrides[definition.key] ?? fromConfig[definition.key]
            ?? (typeof definition.fallback === 'boolean' ? definition.fallback : null),
        source: overrides[definition.key] === undefined ? 'default' : 'override',
        hasDefault: fromConfig[definition.key] !== undefined || definition.fallback !== null,
    }));
}

const UModalStub = {
    name: 'UModal',
    props: [ 'open', 'title', 'dismissible' ],
    template: '<div v-if="open" class="modal"><slot name="body" /></div>',
};

const UButtonStub = {
    name: 'UButton',
    props: [ 'label', 'loading', 'disabled' ],
    template: '<button>{{ label }}</button>',
};

function mountModal() : VueWrapper
{
    return mount(RemoveProviderModal, {
        global: { stubs: { UModal: UModalStub, UButton: UButtonStub } },
    });
}

function openFor(wrapper : VueWrapper, provider : SocialProviderID) : void
{
    (wrapper.vm as unknown as { open : (provider : SocialProviderID) => void }).open(provider);
}

function buttonLabeled(wrapper : VueWrapper, label : string) : DOMWrapper<Element> | undefined
{
    return wrapper.findAll('button').find((button) => button.text() === label);
}

//----------------------------------------------------------------------------------------------------------------------

describe('RemoveProviderModal', () =>
{
    beforeEach(() =>
    {
        setActivePinia(createPinia());
        vi.clearAllMocks();
    });

    it('resets every override the provider owns in one atomic patch', async () =>
    {
        const settings = useAdminSettingsStore();
        settings.entries = entriesWith({ GITLAB_CLIENT_ID: 'gl-id', GITLAB_ISSUER: 'https://git.example.com' });
        patchMock.mockResolvedValue({ settings: settings.entries, restartRequired: true });

        const wrapper = mountModal();
        openFor(wrapper, 'gitlab');
        await flushPromises();

        await buttonLabeled(wrapper, 'Remove')?.trigger('click');
        await flushPromises();

        expect(patchMock).toHaveBeenCalledOnce();
        expect(patchMock).toHaveBeenCalledWith({ GITLAB_CLIENT_ID: null, GITLAB_ISSUER: null });
        expect(wrapper.emitted('removed')).toEqual([ [ 'gitlab' ] ]);
        expect(wrapper.find('.modal').exists()).toBe(false);
    });

    it('explains a deployment-config provider instead of offering a Remove that cannot work', async () =>
    {
        const settings = useAdminSettingsStore();
        settings.entries = entriesWith({}, { GITHUB_CLIENT_ID: 'gh-id', GITHUB_CLIENT_SECRET: 'gh-secret' });

        const wrapper = mountModal();
        openFor(wrapper, 'github');
        await flushPromises();

        expect(wrapper.text()).toContain('deployment configuration');
        expect(buttonLabeled(wrapper, 'Remove')).toBeUndefined();
        expect(patchMock).not.toHaveBeenCalled();
    });

    it('cancels without touching anything', async () =>
    {
        const settings = useAdminSettingsStore();
        settings.entries = entriesWith({ DISCORD_CLIENT_ID: 'd-id' });

        const wrapper = mountModal();
        openFor(wrapper, 'discord');
        await flushPromises();

        await buttonLabeled(wrapper, 'Cancel')?.trigger('click');
        await flushPromises();

        expect(patchMock).not.toHaveBeenCalled();
        expect(wrapper.emitted('removed')).toBeUndefined();
        expect(wrapper.find('.modal').exists()).toBe(false);
    });
});

//----------------------------------------------------------------------------------------------------------------------
