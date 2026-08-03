//----------------------------------------------------------------------------------------------------------------------
// Account Layout — the account-area chrome
//
// The account shell's sidebar *is* the tab strip: the account tabs (Profile, Account, Access tokens, Settings) as
// section nav, an escape hatch back to the drive, and the home logo -- and, crucially, none of the drive chrome (no
// New button,
// no drive nav, no storage gauge). What this guards: the tabs are offered in order to their child routes, the escape
// hatch and logo point home, a RouterView carries the active tab, and no drive chrome leaks into the account context.
//----------------------------------------------------------------------------------------------------------------------

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { type VueWrapper, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { createMemoryHistory, createRouter } from 'vue-router';

//----------------------------------------------------------------------------------------------------------------------

vi.mock('@nuxt/ui/composables', () => ({ useToast: () => ({ add: vi.fn() }) }));

// Under test
import AccountLayout from '@client/layouts/accountLayout.vue';

// Drive chrome that must NOT appear in the account shell
import QuotaMeter from '@client/components/quotaMeter.vue';

//----------------------------------------------------------------------------------------------------------------------

interface NavLink { label : string; to : string }

const RouterLinkStub = {
    name: 'RouterLink',
    props: [ 'to' ],
    template: '<a class="router-link" :href="to"><slot /></a>',
};

const UButtonStub = {
    name: 'UButton',
    props: [ 'to', 'label', 'icon' ],
    template: '<a class="ubutton" :href="to">{{ label }}</a>',
};

const UNavigationMenuStub = {
    name: 'UNavigationMenu',
    props: [ 'items', 'orientation' ],
    template: '<nav class="side-nav" :data-orientation="orientation">'
        + '<a v-for="item in items" :key="item.to" class="nav-item" :href="item.to">{{ item.label }}</a></nav>',
};

const RouterViewStub = { name: 'RouterView', template: '<div class="router-view" />' };
const TopBarStub = { name: 'TopBar', template: '<div class="top-bar" />' };

// The shell's narrow-viewport drawer holds a second copy of this same sidebar; closed, it holds nothing, which is
// the state these assertions count links in.
const USlideoverStub = {
    name: 'USlideover',
    props: [ 'open' ],
    template: '<div v-if="open"><slot name="content" /></div>',
};

function mountLayout() : VueWrapper
{
    const router = createRouter({
        history: createMemoryHistory(),
        routes: [ { path: '/:pathMatch(.*)*', component: { template: '<div />' } } ],
    });

    return mount(AccountLayout, {
        global: {
            plugins: [ router ],
            stubs: {
                RouterLink: RouterLinkStub,
                UButton: UButtonStub,
                UNavigationMenu: UNavigationMenuStub,
                RouterView: RouterViewStub,
                TopBar: TopBarStub,
                USlideover: USlideoverStub,
            },
        },
    });
}

function navLinks(wrapper : VueWrapper) : NavLink[]
{
    return wrapper.findAll('.nav-item').map((link) => ({
        label: link.text(),
        to: link.attributes('href') ?? '',
    }));
}

//----------------------------------------------------------------------------------------------------------------------

describe('AccountLayout', () =>
{
    beforeEach(() =>
    {
        setActivePinia(createPinia());
    });

    it('offers Profile, Account, Access tokens, and Settings as sidebar navigation to the tab routes', () =>
    {
        const wrapper = mountLayout();

        expect(navLinks(wrapper)).toEqual([
            { label: 'Profile', to: '/account/profile' },
            { label: 'Account', to: '/account/account' },
            { label: 'Access tokens', to: '/account/tokens' },
            { label: 'Settings', to: '/account/settings' },
        ]);
    });

    it('lays the section nav out vertically as a sidebar', () =>
    {
        const wrapper = mountLayout();

        expect(wrapper.find('.side-nav').attributes('data-orientation')).toBe('vertical');
    });

    it('offers a Back to Files escape hatch to the drive root', () =>
    {
        const wrapper = mountLayout();

        const backLink = wrapper.findAll('.ubutton').find((link) => link.text() === 'Back to Files');

        expect(backLink?.attributes('href')).toBe('/');
    });

    it('links the logo home', () =>
    {
        const wrapper = mountLayout();

        const logo = wrapper.find('.router-link');

        expect(logo.attributes('href')).toBe('/');
        expect(logo.text()).toContain('FileShed');
    });

    it('renders a RouterView outlet for the active tab', () =>
    {
        const wrapper = mountLayout();

        expect(wrapper.find('.router-view').exists()).toBe(true);
    });

    it('carries no drive chrome — no New button, no drive nav, no storage gauge', () =>
    {
        const wrapper = mountLayout();

        // Back to Files is the only button; a New creation button would show up here.
        expect(wrapper.findAll('.ubutton').map((link) => link.text())).toEqual([ 'Back to Files' ]);

        // The section nav is exactly the account tabs -- no My Files / Shared with me / Trash.
        expect(navLinks(wrapper).map((link) => link.to)).toEqual([
            '/account/profile',
            '/account/account',
            '/account/tokens',
            '/account/settings',
        ]);

        expect(wrapper.findComponent(QuotaMeter).exists()).toBe(false);
    });
});

//----------------------------------------------------------------------------------------------------------------------
