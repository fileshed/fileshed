//----------------------------------------------------------------------------------------------------------------------
// Remote Media — the account-page toggle for playing media hosted elsewhere
//
// Only the preferences RA is mocked; the real session store runs. The switch reflects the stored preference and
// defaults ON, because a playlist pointing somewhere else is an ordinary part of the format and refusing one by
// default would break playlists that already work. Turning it off is the reader saying their browser should not
// answer a URL somebody else put in a playlist.
//----------------------------------------------------------------------------------------------------------------------

import { type Mock, beforeEach, describe, expect, it, vi } from 'vitest';
import { type VueWrapper, flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';

// Resource Access
import { updatePreferences } from '@client/resource-access/preferences.ts';

// Stores
import { useSessionStore } from '@client/stores/session.ts';

// Support
import { meFixture } from '../../support.ts';

// Under test
import RemoteMedia from '@client/components/account/remoteMedia.vue';

//----------------------------------------------------------------------------------------------------------------------

vi.mock('@client/resource-access/preferences.ts', () => ({ updatePreferences: vi.fn() }));
vi.mock('@nuxt/ui/composables', () => ({ useToast: () => ({ add: vi.fn() }) }));

const updatePreferencesMock = updatePreferences as unknown as Mock;

//----------------------------------------------------------------------------------------------------------------------

const USwitchStub = {
    name: 'USwitch',
    props: [ 'modelValue', 'disabled' ],
    emits: [ 'update:modelValue' ],
    template: '<button class="remote-switch" :data-on="modelValue" '
        + '@click="$emit(\'update:modelValue\', !modelValue)"></button>',
};

function mountToggle() : VueWrapper
{
    return mount(RemoteMedia, { global: { stubs: { USwitch: USwitchStub } } });
}

//----------------------------------------------------------------------------------------------------------------------

describe('RemoteMedia', () =>
{
    beforeEach(() =>
    {
        setActivePinia(createPinia());
        vi.clearAllMocks();
    });

    it('defaults to on when the user has never chosen', () =>
    {
        const session = useSessionStore();
        session.me = meFixture({ preferences: {} });

        const toggle = mountToggle().find('.remote-switch');

        expect(toggle.attributes('data-on')).toBe('true');
    });

    it('reflects a stored refusal', () =>
    {
        const session = useSessionStore();
        session.me = meFixture({ preferences: { allowRemoteMedia: false } });

        const toggle = mountToggle().find('.remote-switch');

        expect(toggle.attributes('data-on')).toBe('false');
    });

    it('turns it off and the store adopts it', async () =>
    {
        const session = useSessionStore();
        session.me = meFixture({ preferences: {} });
        updatePreferencesMock.mockResolvedValue(meFixture({ preferences: { allowRemoteMedia: false } }));
        const wrapper = mountToggle();

        await wrapper.find('.remote-switch').trigger('click');
        await flushPromises();

        expect(updatePreferencesMock).toHaveBeenCalledWith({ allowRemoteMedia: false });
        expect(session.allowRemoteMedia).toBe(false);
    });

    // The concern is not something a user would guess at from the label, so the control carries it.
    it('says what playing a remote entry tells the other site', () =>
    {
        const session = useSessionStore();
        session.me = meFixture({ preferences: {} });

        const text = mountToggle().text();

        expect(text).toMatch(/IP address/u);
        expect(text).toMatch(/shared with you/u);
    });
});

//----------------------------------------------------------------------------------------------------------------------
