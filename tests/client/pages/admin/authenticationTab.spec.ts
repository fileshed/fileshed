//----------------------------------------------------------------------------------------------------------------------
// Admin Authentication Tab — the uncurated provider list
//
// Nothing renders until a provider is added or configured: a fresh instance shows only the add-provider picker,
// a provider with any stored value keeps its group on every visit, picking one from the menu opens its group for
// entry, and every group spells out the callback URL its OAuth app must whitelist. The wrapper decides per
// provider whether the generic credential pair or a specific field set renders -- that switch has its own spec.
//----------------------------------------------------------------------------------------------------------------------

import { type Mock, beforeEach, describe, expect, it, vi } from 'vitest';
import { type VueWrapper, flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { defineComponent } from 'vue';

import {
    type AdminSettingEntry,
    type AdminSettingsResponse,
    settingDefinitions,
    socialProviderIDs,
} from '@fileshed/core';

// Resource Access
import { fetchAdminSettings } from '@client/resource-access/admin.ts';

// Utils
import { copyToClipboard } from '@client/utils/copyToClipboard.ts';

// Components
import ProviderFields from '@client/components/admin/providers/providerFields.vue';

// Under test
import AuthenticationTab from '@client/pages/admin/authenticationTab.vue';

//----------------------------------------------------------------------------------------------------------------------

vi.mock('@client/resource-access/admin.ts', () => ({
    fetchAdminSettings: vi.fn(),
    patchAdminSettings: vi.fn(),
}));
vi.mock('@client/utils/copyToClipboard.ts', () => ({ copyToClipboard: vi.fn().mockResolvedValue(true) }));
vi.mock('@nuxt/ui/composables', () => ({ useToast: () => ({ add: vi.fn() }) }));

const fetchMock = fetchAdminSettings as unknown as Mock;
const copyMock = copyToClipboard as unknown as Mock;

//----------------------------------------------------------------------------------------------------------------------

// A full vocabulary view with every provider key at its default, plus any overrides a case sets.
function view(values : Partial<Record<string, string>> = {}) : AdminSettingsResponse
{
    const settings = Object.values(settingDefinitions).map((definition) : AdminSettingEntry => ({
        key: definition.key,
        kind: definition.kind,
        secret: definition.secret,
        requiresRestart: definition.requiresRestart,
        value: values[definition.key] ?? (typeof definition.fallback === 'boolean' ? definition.fallback : null),
        source: values[definition.key] === undefined ? 'default' : 'override',
        hasDefault: definition.fallback !== null,
    }));

    return { settings, restartRequired: false };
}

const USelectMenuStub = {
    name: 'USelectMenu',
    props: [ 'modelValue', 'items' ],
    emits: [ 'update:modelValue' ],
    template: '<select class="add-provider" @change="$emit(\'update:modelValue\', $event.target.value)">'
        + '<option v-for="item of items" :key="item.value" :value="item.value">{{ item.label }}</option></select>',
};

// The page opens the removal modal through a template ref, so the stub must be a real component exposing open().
const modalOpenSpy = vi.fn();
const RemoveProviderModalStub = defineComponent({
    name: 'RemoveProviderModal',
    setup(_, { expose })
    {
        expose({ open: modalOpenSpy });
        return () => null;
    },
});

function mountTab() : VueWrapper
{
    return mount(AuthenticationTab, {
        global: {
            stubs: {
                ProviderFields: true,
                RestartBanner: true,
                RemoveProviderModal: RemoveProviderModalStub,
                USelectMenu: USelectMenuStub,
                UCard: { name: 'UCard', template: '<div class="provider-card"><slot name="header" /><slot /></div>' },
                UButton: { name: 'UButton', template: '<button><slot /></button>' },
                UIcon: true,
                UAlert: { name: 'UAlert', props: [ 'title' ], template: '<div class="alert">{{ title }}</div>' },
            },
        },
    });
}

//----------------------------------------------------------------------------------------------------------------------

describe('Admin AuthenticationTab', () =>
{
    beforeEach(() =>
    {
        setActivePinia(createPinia());
        vi.clearAllMocks();
    });

    it('shows no provider groups on a fresh instance, only the add-provider picker', async () =>
    {
        fetchMock.mockResolvedValue(view());
        const wrapper = mountTab();
        await flushPromises();

        expect(wrapper.findAllComponents(ProviderFields)).toHaveLength(0);
        expect(wrapper.text()).toContain('No sign-in providers configured');
        expect(wrapper.find('.add-provider').exists()).toBe(true);
    });

    it('keeps a group open for every provider with any stored value, callback URL spelled out', async () =>
    {
        fetchMock.mockResolvedValue(view({ GITLAB_CLIENT_ID: 'gl-id', DISCORD_CLIENT_SECRET: '••••cret' }));
        const wrapper = mountTab();
        await flushPromises();

        const providers = wrapper.findAllComponents(ProviderFields).map((fields) => fields.props('provider'));
        expect(providers.sort()).toEqual([ 'discord', 'gitlab' ]);
        expect(wrapper.findAll('.provider-card')).toHaveLength(2);
        expect(wrapper.text()).toContain('/api/auth/callback/gitlab');
        expect(wrapper.text()).toContain('/api/auth/callback/discord');
    });

    it('opens a group for entry when a provider is picked, and drops it from the picker', async () =>
    {
        fetchMock.mockResolvedValue(view());
        const wrapper = mountTab();
        await flushPromises();

        await wrapper.find('.add-provider').setValue('spotify');
        await flushPromises();

        expect(wrapper.findAllComponents(ProviderFields).map((fields) => fields.props('provider')))
            .toEqual([ 'spotify' ]);

        const options = wrapper.findAll('.add-provider option').map((option) => option.attributes('value'));
        expect(options).not.toContain('spotify');
        expect(options.length).toBe(socialProviderIDs.length - 1);
    });

    it('links a card to the provider developer console when one is known, and stays quiet when none is', async () =>
    {
        fetchMock.mockResolvedValue(view({ GITLAB_CLIENT_ID: 'gl-id', POLAR_CLIENT_ID: 'p-id' }));
        const wrapper = mountTab();
        await flushPromises();

        const [ gitlabCard, polarCard ] = wrapper.findAll('.provider-card');
        if(gitlabCard === undefined || polarCard === undefined) { throw new Error('no provider cards'); }

        const link = gitlabCard.find('a');
        expect(link.exists()).toBe(true);
        expect(link.attributes('href')).toContain('gitlab.com');
        expect(link.attributes('target')).toBe('_blank');
        expect(link.attributes('rel')).toBe('noopener');

        expect(polarCard.find('a').exists()).toBe(false);
    });

    it('copies the callback URL to the clipboard from the card', async () =>
    {
        fetchMock.mockResolvedValue(view({ GITLAB_CLIENT_ID: 'gl-id' }));
        const wrapper = mountTab();
        await flushPromises();

        await wrapper.find('[aria-label="Copy the GitLab callback URL"]').trigger('click');
        await flushPromises();

        expect(copyMock).toHaveBeenCalledWith(`${ window.location.origin }/api/auth/callback/gitlab`);
    });

    it('removes an unsaved provider instantly and returns it to the picker', async () =>
    {
        fetchMock.mockResolvedValue(view());
        const wrapper = mountTab();
        await flushPromises();

        await wrapper.find('.add-provider').setValue('spotify');
        await flushPromises();
        expect(wrapper.findAll('.provider-card')).toHaveLength(1);

        await wrapper.find('[aria-label="Remove Spotify"]').trigger('click');
        await flushPromises();

        expect(wrapper.findAll('.provider-card')).toHaveLength(0);
        expect(wrapper.text()).toContain('No sign-in providers configured');
        expect(wrapper.findAll('.add-provider option')).toHaveLength(socialProviderIDs.length);
        expect(modalOpenSpy).not.toHaveBeenCalled();
    });

    it('sends removal of a provider with stored values through the confirming modal', async () =>
    {
        fetchMock.mockResolvedValue(view({ GITLAB_CLIENT_ID: 'gl-id' }));
        const wrapper = mountTab();
        await flushPromises();

        await wrapper.find('[aria-label="Remove GitLab"]').trigger('click');
        await flushPromises();

        expect(modalOpenSpy).toHaveBeenCalledWith('gitlab');
        expect(wrapper.findAll('.provider-card')).toHaveLength(1);
    });

    it('shows the retry state when the load fails', async () =>
    {
        fetchMock.mockRejectedValue(new Error('offline'));
        const wrapper = mountTab();
        await flushPromises();

        expect(wrapper.find('.alert').text()).toContain('Couldn\'t load the instance settings.');
    });
});

//----------------------------------------------------------------------------------------------------------------------
