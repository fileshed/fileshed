//----------------------------------------------------------------------------------------------------------------------
// Color Mode Preference — the account-page appearance control
//
// Only the preferences RA is mocked; the real stores run. The active segment mirrors the stored choice (System
// standing in while none exists), choosing another mode saves it through the preferences blob, re-choosing the
// active one never hits the wire, and a forced instance mode replaces the whole control with an explanation --
// offering a choice that would not apply is a lie.
//----------------------------------------------------------------------------------------------------------------------

import { type Mock, beforeEach, describe, expect, it, vi } from 'vitest';
import { type VueWrapper, flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';

// Resource Access
import { updatePreferences } from '@client/resource-access/preferences.ts';

// Stores
import { useAppStore } from '@client/stores/app.ts';
import { useSessionStore } from '@client/stores/session.ts';

// Support
import { meFixture } from '../../support.ts';

// Under test
import ColorModePreference from '@client/components/account/colorModePreference.vue';

//----------------------------------------------------------------------------------------------------------------------

vi.mock('@client/resource-access/preferences.ts', () => ({ updatePreferences: vi.fn() }));
vi.mock('@client/resource-access/instance.ts', () => ({ fetchInstance: vi.fn() }));
vi.mock('@nuxt/ui/composables', () => ({ useToast: () => ({ add: vi.fn() }) }));

const updatePreferencesMock = updatePreferences as unknown as Mock;

//----------------------------------------------------------------------------------------------------------------------

const UButtonStub = {
    name: 'UButton',
    props: [ 'label', 'variant', 'color', 'disabled' ],
    emits: [ 'click' ],
    template: '<button class="mode-btn" :data-variant="variant" @click="$emit(\'click\')">{{ label }}</button>',
};

function mountControl() : VueWrapper
{
    return mount(ColorModePreference, {
        global: { stubs: { UFieldGroup: { template: '<div><slot /></div>' }, UButton: UButtonStub } },
    });
}

//----------------------------------------------------------------------------------------------------------------------

describe('ColorModePreference', () =>
{
    beforeEach(() =>
    {
        setActivePinia(createPinia());
        vi.clearAllMocks();
    });

    it('marks System active while no choice is stored, and the stored choice once one is', () =>
    {
        const session = useSessionStore();
        session.me = meFixture();

        const unchosen = mountControl().findAll('.mode-btn');
        expect(unchosen[0]?.attributes('data-variant')).toBe('solid');

        session.me = meFixture({ preferences: { colorMode: 'dark' } });
        const chosen = mountControl().findAll('.mode-btn');
        expect(chosen[2]?.attributes('data-variant')).toBe('solid');
    });

    it('saves a chosen mode through the preferences blob and paints it optimistically', async () =>
    {
        const session = useSessionStore();
        session.me = meFixture();
        updatePreferencesMock.mockResolvedValue(meFixture({ preferences: { colorMode: 'dark' } }));

        const wrapper = mountControl();
        await wrapper.findAll('.mode-btn')[2]?.trigger('click');

        expect(session.colorMode).toBe('dark');

        await flushPromises();
        expect(updatePreferencesMock).toHaveBeenCalledWith({ colorMode: 'dark' });
    });

    it('never hits the wire for the mode already in force', async () =>
    {
        const session = useSessionStore();
        session.me = meFixture({ preferences: { colorMode: 'light' } });

        await mountControl().findAll('.mode-btn')[1]?.trigger('click');
        await flushPromises();

        expect(updatePreferencesMock).not.toHaveBeenCalled();
    });

    it('replaces the choice with an explanation when the instance forces a mode', () =>
    {
        const session = useSessionStore();
        session.me = meFixture();
        const app = useAppStore();
        app.branding = { instanceName: 'FileShed', mode: 'dark', forcedMode: true, logo: null };

        const wrapper = mountControl();

        expect(wrapper.findAll('.mode-btn')).toHaveLength(0);
        expect(wrapper.text()).toContain('administrator has set the appearance');
    });
});

//----------------------------------------------------------------------------------------------------------------------
