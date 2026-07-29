//----------------------------------------------------------------------------------------------------------------------
// Settings Tab — preferences composition
//
// The tab re-parents the existing preference controls under two headings. What this guards: the Preferences group
// (files-root name, time format) and the Editor group (colorscheme, line numbers) are all present, in order, so the
// move never silently drops one.
//----------------------------------------------------------------------------------------------------------------------

import { describe, expect, it, vi } from 'vitest';
import { type VueWrapper, mount } from '@vue/test-utils';

// The controls pull in @nuxt/ui's composables transitively (via the toast helper); stub that seam so importing them
// for the composition assertions never loads the Nuxt-only runtime.
vi.mock('@nuxt/ui/composables', () => ({ useToast: () => ({ add: vi.fn() }) }));

// Under test
import SettingsTab from '@client/pages/account/settingsTab.vue';

// Composed controls
import FilesRootName from '@client/components/account/filesRootName.vue';
import TimeFormat from '@client/components/account/timeFormat.vue';
import ColorModePreference from '@client/components/account/colorModePreference.vue';
import EditorColorScheme from '@client/components/account/editorColorScheme.vue';
import EditorGutter from '@client/components/account/editorGutter.vue';

//----------------------------------------------------------------------------------------------------------------------

function mountTab() : VueWrapper
{
    return mount(SettingsTab, {
        global: {
            stubs: {
                FilesRootName: true,
                TimeFormat: true,
                ColorModePreference: true,
                EditorColorScheme: true,
                EditorGutter: true,
            },
        },
    });
}

//----------------------------------------------------------------------------------------------------------------------

describe('SettingsTab', () =>
{
    it('groups the controls under the Preferences and Editor headings in order', () =>
    {
        const wrapper = mountTab();

        expect(wrapper.findAll('h2').map((heading) => heading.text())).toEqual([ 'Preferences', 'Editor' ]);
    });

    it('keeps the general and editor preference controls', () =>
    {
        const wrapper = mountTab();

        expect(wrapper.findComponent(FilesRootName).exists()).toBe(true);
        expect(wrapper.findComponent(TimeFormat).exists()).toBe(true);
        expect(wrapper.findComponent(ColorModePreference).exists()).toBe(true);
        expect(wrapper.findComponent(EditorColorScheme).exists()).toBe(true);
        expect(wrapper.findComponent(EditorGutter).exists()).toBe(true);
    });
});

//----------------------------------------------------------------------------------------------------------------------
