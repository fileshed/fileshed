//----------------------------------------------------------------------------------------------------------------------
// Markdown HTML — the account-page toggle for rendering HTML in others' markdown
//
// Only the preferences RA is mocked; the real session store runs. The switch reflects the stored preference and
// defaults off, because rendered HTML in a file someone else wrote can be made to look like FileShed's own screens.
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
import MarkdownHTML from '@client/components/account/markdownHTML.vue';

//----------------------------------------------------------------------------------------------------------------------

vi.mock('@client/resource-access/preferences.ts', () => ({ updatePreferences: vi.fn() }));
vi.mock('@nuxt/ui/composables', () => ({ useToast: () => ({ add: vi.fn() }) }));

const updatePreferencesMock = updatePreferences as unknown as Mock;

//----------------------------------------------------------------------------------------------------------------------

const UBadgeStub = { name: 'UBadge', props: [ 'label' ], template: '<span class="badge">{{ label }}</span>' };

const USwitchStub = {
    name: 'USwitch',
    props: [ 'modelValue', 'disabled' ],
    emits: [ 'update:modelValue' ],
    template: '<button class="html-switch" :data-on="modelValue" '
        + '@click="$emit(\'update:modelValue\', !modelValue)"></button>',
};

function mountToggle() : VueWrapper
{
    return mount(MarkdownHTML, { global: { stubs: { USwitch: USwitchStub, UBadge: UBadgeStub } } });
}

//----------------------------------------------------------------------------------------------------------------------

describe('MarkdownHTML', () =>
{
    beforeEach(() =>
    {
        setActivePinia(createPinia());
        vi.clearAllMocks();
    });

    it('defaults to off when the user has never chosen', () =>
    {
        const session = useSessionStore();
        session.me = meFixture({ preferences: {} });

        const toggle = mountToggle().find('.html-switch');

        expect(toggle.attributes('data-on')).toBe('false');
    });

    it('reflects a stored choice to render', () =>
    {
        const session = useSessionStore();
        session.me = meFixture({ preferences: { showMarkdownHTML: true } });

        const toggle = mountToggle().find('.html-switch');

        expect(toggle.attributes('data-on')).toBe('true');
    });

    it('turns it on and the store adopts it', async () =>
    {
        const session = useSessionStore();
        session.me = meFixture({ preferences: {} });
        updatePreferencesMock.mockResolvedValue(meFixture({ preferences: { showMarkdownHTML: true } }));
        const wrapper = mountToggle();

        await wrapper.find('.html-switch').trigger('click');
        await flushPromises();

        expect(updatePreferencesMock).toHaveBeenCalledWith({ showMarkdownHTML: true });
        expect(session.showMarkdownHTML).toBe(true);
    });

    // Among the editor's appearance settings, this is the one that changes what someone else's file can do. The tag
    // is what marks it.
    it('marks itself as a security setting', () =>
    {
        const session = useSessionStore();
        session.me = meFixture({ preferences: {} });

        const badge = mountToggle().find('.badge');

        expect(badge.text()).toBe('Security');
    });
});

//----------------------------------------------------------------------------------------------------------------------
