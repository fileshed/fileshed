//----------------------------------------------------------------------------------------------------------------------
// Not Found Page
//
// What an unmatched URL owes the visitor: a plain statement that the page does not exist, and two ways out that both
// work. "Go back" is the interesting one -- a 404 is usually reached from outside the app, where there is no previous
// page, and a button that quietly does nothing is worse than no button. A real memory router runs so both exits are
// asserted by where the visitor ends up, not by which method was called.
//----------------------------------------------------------------------------------------------------------------------

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type VueWrapper, flushPromises, mount } from '@vue/test-utils';
import { type Router, createMemoryHistory, createRouter } from 'vue-router';
import { createPinia, setActivePinia } from 'pinia';

// Under test
import NotFoundPage from '@client/pages/notFoundPage.vue';

//----------------------------------------------------------------------------------------------------------------------

const UButtonStub = {
    name: 'UButton',
    props: [ 'to', 'label', 'icon', 'color', 'variant' ],
    emits: [ 'click' ],
    template: '<button class="ubutton" :data-to="to" @click="$emit(\'click\')">{{ label }}</button>',
};

const blank = { template: '<div />' };

function testRouter() : Router
{
    return createRouter({
        history: createMemoryHistory(),
        routes: [
            { path: '/', name: 'drive', component: blank },
            { path: '/trash', name: 'trash', component: blank },
            { path: '/:pathMatch(.*)*', name: 'not-found', component: blank },
        ],
    });
}

// The tab's session-history depth is what tells the page whether there is anywhere to go back to; jsdom pins it at 1.
function setHistoryLength(length : number) : void
{
    Object.defineProperty(window.history, 'length', { configurable: true, get: () => length });
}

interface Mounted { wrapper : VueWrapper; router : Router }

// Every case starts the same way: the visitor was on /trash and followed something broken to /nowhere. Only the
// tab's history depth differs between the two "Go back" cases, so the exits can't both be right by accident.
async function mountPage(historyLength = 1) : Promise<Mounted>
{
    setHistoryLength(historyLength);

    const router = testRouter();
    await router.push('/trash');
    await router.push('/nowhere');

    const wrapper = mount(NotFoundPage, {
        global: { plugins: [ router ], stubs: { UButton: UButtonStub } },
    });

    return { wrapper, router };
}

function button(wrapper : VueWrapper, label : string) : ReturnType<VueWrapper['find']> | undefined
{
    return wrapper.findAll('.ubutton').find((candidate) => candidate.text() === label);
}

//----------------------------------------------------------------------------------------------------------------------

describe('NotFoundPage', () =>
{
    beforeEach(() =>
    {
        setActivePinia(createPinia());
    });

    afterEach(() =>
    {
        Reflect.deleteProperty(window.history, 'length');
    });

    it('tells the visitor the page does not exist, as a 404', async () =>
    {
        const { wrapper } = await mountPage();

        expect(wrapper.text()).toContain('404');
        expect(wrapper.text()).toContain('doesn\'t exist');
    });

    it('offers Back to Files pointing at the drive root', async () =>
    {
        const { wrapper } = await mountPage();

        expect(button(wrapper, 'Back to Files')?.attributes('data-to')).toBe('/');
    });

    it('carries the instance identity home', async () =>
    {
        const { wrapper } = await mountPage();

        const wordmark = wrapper.find('a');

        expect(wordmark.attributes('href')).toBe('/');
        expect(wordmark.text()).toContain('FileShed');
    });

    it('returns to the previous page when the tab has one', async () =>
    {
        const { wrapper, router } = await mountPage(3);

        await button(wrapper, 'Go back')?.trigger('click');
        await flushPromises();

        expect(router.currentRoute.value.path).toBe('/trash');
    });

    it('lands on the drive when there is no previous page to return to', async () =>
    {
        const { wrapper, router } = await mountPage(1);

        await button(wrapper, 'Go back')?.trigger('click');
        await flushPromises();

        expect(router.currentRoute.value.path).toBe('/');
    });
});

//----------------------------------------------------------------------------------------------------------------------
