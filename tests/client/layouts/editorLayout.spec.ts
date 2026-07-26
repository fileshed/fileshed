//----------------------------------------------------------------------------------------------------------------------
// Editor Layout — the file surface's own chrome
//
// The editor shell is a slim header over a full-viewport region: the FileShed mark links home, a center region carries
// the mounted handler's identity, the user menu sits at the far right, and a RouterView carries the mounted handler.
// What this guards: the mark links home and is the icon mark (not the sidebar wordmark), the header exposes the
// #editor-header-center teleport target families contribute into, the user menu is present, a RouterView outlet exists,
// and none of the drive chrome (no New button, no drive nav, no storage gauge, no search box) leaks into the editor.
//----------------------------------------------------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';
import { type VueWrapper, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';

// Under test
import EditorLayout from '@client/layouts/editorLayout.vue';

// Drive chrome that must NOT appear in the editor shell
import QuotaMeter from '@client/components/quotaMeter.vue';

//----------------------------------------------------------------------------------------------------------------------

const RouterLinkStub = {
    name: 'RouterLink',
    props: [ 'to' ],
    template: '<a class="router-link" :href="to"><slot /></a>',
};

const RouterViewStub = { name: 'RouterView', template: '<div class="router-view" />' };
const UserMenuStub = { name: 'UserMenu', template: '<div class="user-menu" />' };

function mountLayout() : VueWrapper
{
    setActivePinia(createPinia());

    return mount(EditorLayout, {
        global: {
            stubs: {
                RouterLink: RouterLinkStub,
                RouterView: RouterViewStub,
                UserMenu: UserMenuStub,
            },
        },
    });
}

//----------------------------------------------------------------------------------------------------------------------

describe('EditorLayout', () =>
{
    it('links the icon mark home, without the sidebar wordmark', () =>
    {
        const wrapper = mountLayout();

        const logo = wrapper.find('.router-link');

        expect(logo.attributes('href')).toBe('/');
        expect(logo.find('img').exists()).toBe(true);
        expect(logo.text()).toBe('');
    });

    it('mounts the user menu', () =>
    {
        const wrapper = mountLayout();

        expect(wrapper.find('.user-menu').exists()).toBe(true);
    });

    it('renders a RouterView outlet for the mounted handler', () =>
    {
        const wrapper = mountLayout();

        expect(wrapper.find('.router-view').exists()).toBe(true);
    });

    it('exposes the header center region families teleport their identity into', () =>
    {
        const wrapper = mountLayout();

        expect(wrapper.find('#editor-header-center').exists()).toBe(true);
    });

    it('carries no drive chrome — no New button, no drive nav, no storage gauge, no search box', () =>
    {
        const wrapper = mountLayout();

        expect(wrapper.findComponent(QuotaMeter).exists()).toBe(false);
        expect(wrapper.findComponent({ name: 'UNavigationMenu' }).exists()).toBe(false);
        expect(wrapper.find('input').exists()).toBe(false);
        expect(wrapper.findAll('button')).toHaveLength(0);
    });
});

//----------------------------------------------------------------------------------------------------------------------
