//----------------------------------------------------------------------------------------------------------------------
// Provider Fields — the per-provider component switch
//
// The wrapper's whole contract: providers whose OAuth shape wants more than a credential pair get their specific
// component, everyone else gets the generic pair. What this guards: adding a provider upstream can never silently
// render the wrong fields -- cognito without its pool coordinates, tiktok with a client-id field its protocol
// does not use.
//----------------------------------------------------------------------------------------------------------------------

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';

import type { SocialProviderID } from '@fileshed/core';

// Components
import AppleProviderFields from '@client/components/admin/providers/appleProviderFields.vue';
import CognitoProviderFields from '@client/components/admin/providers/cognitoProviderFields.vue';
import GenericProviderFields from '@client/components/admin/providers/genericProviderFields.vue';
import GitlabProviderFields from '@client/components/admin/providers/gitlabProviderFields.vue';
import MicrosoftProviderFields from '@client/components/admin/providers/microsoftProviderFields.vue';
import TiktokProviderFields from '@client/components/admin/providers/tiktokProviderFields.vue';

// Under test
import ProviderFields from '@client/components/admin/providers/providerFields.vue';

//----------------------------------------------------------------------------------------------------------------------

vi.mock('@nuxt/ui/composables', () => ({ useToast: () => ({ add: vi.fn() }) }));

function mountFor(provider : SocialProviderID) : ReturnType<typeof mount>
{
    return mount(ProviderFields, {
        props: { provider },
        global: { stubs: { SettingField: true, UAlert: true } },
    });
}

//----------------------------------------------------------------------------------------------------------------------

describe('ProviderFields', () =>
{
    beforeEach(() =>
    {
        setActivePinia(createPinia());
    });

    it('switches to the specific component for providers whose contract wants more than a pair', () =>
    {
        expect(mountFor('apple').findComponent(AppleProviderFields)
            .exists()).toBe(true);
        expect(mountFor('cognito').findComponent(CognitoProviderFields)
            .exists()).toBe(true);
        expect(mountFor('gitlab').findComponent(GitlabProviderFields)
            .exists()).toBe(true);
        expect(mountFor('microsoft').findComponent(MicrosoftProviderFields)
            .exists()).toBe(true);
        expect(mountFor('tiktok').findComponent(TiktokProviderFields)
            .exists()).toBe(true);
    });

    it('renders the generic credential pair for everyone else', () =>
    {
        for(const provider of [ 'github', 'discord', 'spotify', 'wechat' ] as const)
        {
            expect(mountFor(provider).findComponent(GenericProviderFields)
                .exists()).toBe(true);
        }
    });
});

//----------------------------------------------------------------------------------------------------------------------
