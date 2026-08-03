//----------------------------------------------------------------------------------------------------------------------
// App Shell — the chrome every signed-in area is built from
//
// What this guards: an area describes its navigation once and gets it in both homes -- the fixed rail and the narrow-
// viewport drawer the top bar's hamburger opens -- the drawer never outlives a navigation, and the overlay chrome
// stays out of the region that scrolls.
//----------------------------------------------------------------------------------------------------------------------

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { type VueWrapper, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { type Router, createMemoryHistory, createRouter } from 'vue-router';

//----------------------------------------------------------------------------------------------------------------------

vi.mock('@nuxt/ui/composables', () => ({ useToast: () => ({ add: vi.fn() }) }));

// Under test
import AppShell from '@client/components/layout/appShell.vue';

//----------------------------------------------------------------------------------------------------------------------

const UButtonStub = {
    name: 'UButton',
    props: [ 'icon', 'label' ],
    template: '<button class="ubutton" :data-icon="icon">{{ label }}<slot /></button>',
};

// The drawer is a Nuxt UI slideover, which portals its content out of the wrapper. Stand in for it with a plain
// element that honours the same open/closed contract so the assertions can see what the drawer is holding.
const USlideoverStub = {
    name: 'USlideover',
    props: [ 'open', 'side', 'title', 'ui' ],
    template: '<div v-if="open" class="drawer" :data-side="side"><slot name="content" /></div>',
};

// The shell hangs the drawer trigger in the top bar's leading slot, so a stub that drops slots would hide it.
const TopBarStub = { name: 'TopBar', template: '<div class="top-bar"><slot name="leading" /></div>' };

const blank = { template: '<div />' };

function buildRouter() : Router
{
    return createRouter({
        history: createMemoryHistory(),
        routes: [
            { path: '/', component: blank },
            { path: '/trash', component: blank },
        ],
    });
}

async function mountShell(router : Router) : Promise<VueWrapper>
{
    await router.push('/');
    await router.isReady();

    return mount(AppShell, {
        slots: {
            sidebar: '<a class="side-link" href="/trash">Trash</a>',
            default: '<div class="routed">Routed content</div>',
            overlays: '<div class="upload-panel" />',
        },
        global: {
            plugins: [ router ],
            stubs: { UButton: UButtonStub, USlideover: USlideoverStub, TopBar: TopBarStub },
        },
    });
}

function hamburger(wrapper : VueWrapper) : ReturnType<VueWrapper['find']>
{
    return wrapper.find('.top-bar .ubutton');
}

//----------------------------------------------------------------------------------------------------------------------

describe('AppShell', () =>
{
    let router : Router;

    beforeEach(() =>
    {
        setActivePinia(createPinia());
        router = buildRouter();
    });

    it('renders the area\'s sidebar content in the fixed rail, with the drawer closed', async () =>
    {
        const wrapper = await mountShell(router);

        expect(wrapper.find('aside .side-link').exists()).toBe(true);
        expect(wrapper.find('.drawer').exists()).toBe(false);
    });

    it('opens the drawer from the top bar, carrying the same sidebar content', async () =>
    {
        const wrapper = await mountShell(router);

        await hamburger(wrapper).trigger('click');

        expect(wrapper.find('.drawer .side-link').text()).toBe('Trash');
        expect(wrapper.findAll('.side-link')).toHaveLength(2);
    });

    it('slides the drawer in from the left', async () =>
    {
        const wrapper = await mountShell(router);

        await hamburger(wrapper).trigger('click');

        expect(wrapper.find('.drawer').attributes('data-side')).toBe('left');
    });

    it('closes the drawer on navigation, so a drawer link does not leave it covering the page', async () =>
    {
        const wrapper = await mountShell(router);

        await hamburger(wrapper).trigger('click');
        expect(wrapper.find('.drawer').exists()).toBe(true);

        await router.push('/trash');
        await wrapper.vm.$nextTick();

        expect(wrapper.find('.drawer').exists()).toBe(false);
    });

    it('scrolls the routed content and leaves the overlay chrome outside the scroller', async () =>
    {
        const wrapper = await mountShell(router);

        expect(wrapper.find('main .routed').exists()).toBe(true);
        expect(wrapper.find('main .upload-panel').exists()).toBe(false);
        expect(wrapper.find('.upload-panel').exists()).toBe(true);
    });
});

//----------------------------------------------------------------------------------------------------------------------
