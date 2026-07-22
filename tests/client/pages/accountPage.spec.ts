//----------------------------------------------------------------------------------------------------------------------
// Account Page — sectioned composition
//
// The page is a thin composition that groups the account controls under section headings. What this guards: the four
// sections are present in order, and the editor preference controls -- the second surface over theme and gutter -- are
// actually mounted under the Editor section alongside the existing controls, so the restructure never drops one.
//----------------------------------------------------------------------------------------------------------------------

import { describe, expect, it, vi } from 'vitest';
import { type VueWrapper, mount } from '@vue/test-utils';

// The controls pull in @nuxt/ui's composables transitively; stub that seam so importing them for the composition
// assertions never loads the Nuxt-only runtime.
vi.mock('@nuxt/ui/composables', () => ({ useToast: () => ({ add: vi.fn() }) }));

// Under test
import AccountPage from '@client/pages/accountPage.vue';

// Composed controls
import AccountProfile from '@client/components/account/accountProfile.vue';
import FilesRootName from '@client/components/account/filesRootName.vue';
import TimeFormat from '@client/components/account/timeFormat.vue';
import EditorColorScheme from '@client/components/account/editorColorScheme.vue';
import EditorGutter from '@client/components/account/editorGutter.vue';
import AccountStorage from '@client/components/account/accountStorage.vue';

//----------------------------------------------------------------------------------------------------------------------

function mountPage() : VueWrapper
{
    return mount(AccountPage, {
        global: {
            stubs: {
                AccountProfile: true,
                FilesRootName: true,
                TimeFormat: true,
                EditorColorScheme: true,
                EditorGutter: true,
                AccountStorage: true,
            },
        },
    });
}

//----------------------------------------------------------------------------------------------------------------------

describe('AccountPage', () =>
{
    it('groups controls under the Profile, Preferences, Editor, and Storage sections in order', () =>
    {
        const wrapper = mountPage();
        const headings = wrapper.findAll('h2').map((heading) => heading.text());

        expect(headings).toEqual([ 'Profile', 'Preferences', 'Editor', 'Storage' ]);
    });

    it('surfaces the editor colorscheme and line-numbers controls as a second preferences surface', () =>
    {
        const wrapper = mountPage();

        expect(wrapper.findComponent(EditorColorScheme).exists()).toBe(true);
        expect(wrapper.findComponent(EditorGutter).exists()).toBe(true);
    });

    it('keeps the existing profile, preferences, and storage controls', () =>
    {
        const wrapper = mountPage();

        expect(wrapper.findComponent(AccountProfile).exists()).toBe(true);
        expect(wrapper.findComponent(FilesRootName).exists()).toBe(true);
        expect(wrapper.findComponent(TimeFormat).exists()).toBe(true);
        expect(wrapper.findComponent(AccountStorage).exists()).toBe(true);
    });
});

//----------------------------------------------------------------------------------------------------------------------
