//----------------------------------------------------------------------------------------------------------------------
// Search Box — the top bar's field and its suggestions dropdown
//
// Enter runs the full search page as it always has; the dropdown is a shortcut over that. It appears once the term
// clears the suggestion floor, arrow keys walk its rows, Enter takes whichever row is highlighted, and Escape puts it
// away without disturbing what has been typed. The last row always runs the full search. Drives the real component and
// the real suggestions store, mocking only the resource-access boundary.
//----------------------------------------------------------------------------------------------------------------------

import { type Mock, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type VueWrapper, flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { type Router, createMemoryHistory, createRouter } from 'vue-router';

import type { NodeLocation, NodeResponse, SearchResponse } from '@fileshed/core';

// Resource Access
import { search } from '@client/resource-access/search.ts';

// Under test
import SearchBox from '@client/components/layout/searchBox.vue';

//----------------------------------------------------------------------------------------------------------------------

vi.mock('@client/resource-access/search.ts', () => ({ search: vi.fn() }));

const searchMock = search as unknown as Mock;

const ISO = '2026-07-01T00:00:00.000Z';
const BASE = { ownerID: 'owner1', parentID: null, createdAt: ISO, updatedAt: ISO, role: 'owner' as const };

function folderNode(id : string, name : string) : NodeResponse
{
    return { ...BASE, id, name, type: 'folder', trashedAt: null };
}

function textFileNode(id : string, name : string) : NodeResponse
{
    return { ...BASE, id, name, type: 'file', blobID: 'b1', size: 100, mimeType: 'text/plain', trashedAt: null };
}

function envelope(nodes : NodeResponse[], locations : Record<string, NodeLocation> = {}) : SearchResponse
{
    return {
        nodes,
        total: nodes.length,
        limit: 6,
        offset: 0,
        owners: [],
        locations: {
            ...Object.fromEntries(nodes.map((node) => [ node.id, { crumbs: [], foreign: false } ])),
            ...locations,
        },
    };
}

// The real UInput is a wrapper; this stub is the input element the component binds and listens to.
const STUBS = {
    UInput: {
        props: [ 'modelValue' ],
        emits: [ 'update:modelValue' ],
        template: '<input class="uinput" :value="modelValue" '
            + '@input="$emit(\'update:modelValue\', $event.target.value)" />',
    },
    UIcon: true,
};

async function mountBox() : Promise<{ wrapper : VueWrapper; router : Router }>
{
    setActivePinia(createPinia());

    const router = createRouter({
        history: createMemoryHistory(),
        routes: [
            { path: '/', name: 'drive', component: { template: '<div />' } },
            { path: '/search', name: 'search', component: { template: '<div />' } },
            { path: '/folder/:id', name: 'folder', component: { template: '<div />' } },
        ],
    });
    await router.push('/');
    await router.isReady();

    const wrapper = mount(SearchBox, { global: { plugins: [ router ], stubs: STUBS }, attachTo: document.body });

    return { wrapper, router };
}

// Type a term and let the debounce and the response through.
async function type(wrapper : VueWrapper, value : string) : Promise<void>
{
    await wrapper.get('.uinput').setValue(value);
    await vi.runAllTimersAsync();
    await flushPromises();
}

function rowTexts(wrapper : VueWrapper) : string[]
{
    return wrapper.findAll('[role="option"]').map((row) => row.text());
}

//----------------------------------------------------------------------------------------------------------------------

beforeEach(() =>
{
    vi.clearAllMocks();
    vi.useFakeTimers();
});

afterEach(() => vi.useRealTimers());

//----------------------------------------------------------------------------------------------------------------------

describe('SearchBox', () =>
{
    it('shows nothing until the term clears the suggestion floor', async () =>
    {
        const { wrapper } = await mountBox();
        searchMock.mockResolvedValue(envelope([ folderNode('d1', 'Notes') ]));

        await type(wrapper, 'n');

        expect(searchMock).not.toHaveBeenCalled();
        expect(wrapper.find('[role="listbox"]').exists()).toBe(false);
    });

    it('drops a suggestion list showing each match and where it lives', async () =>
    {
        const { wrapper } = await mountBox();
        searchMock.mockResolvedValue(envelope(
            [ textFileNode('f1', 'notes.txt') ],
            { f1: { crumbs: [ { id: 'p1', name: 'Projects' } ], foreign: false } }
        ));

        await type(wrapper, 'notes');

        expect(rowTexts(wrapper)).toHaveLength(1);
        expect(wrapper.text()).toContain('notes.txt');
        expect(wrapper.text()).toContain('Projects');
    });

    // A bare Enter has always meant "run the search"; the dropdown must not quietly steal it.
    it('runs the full search on Enter when no row is highlighted', async () =>
    {
        const { wrapper, router } = await mountBox();
        searchMock.mockResolvedValue(envelope([ textFileNode('f1', 'notes.txt') ]));
        await type(wrapper, 'notes');
        const push = vi.spyOn(router, 'push');

        await wrapper.get('.uinput').trigger('keydown', { key: 'Enter' });

        expect(push).toHaveBeenCalledWith({ path: '/search', query: { q: 'notes' } });
    });

    it('opens the highlighted file in a new tab when Enter takes it', async () =>
    {
        const { wrapper } = await mountBox();
        searchMock.mockResolvedValue(envelope([ textFileNode('f1', 'notes.txt') ]));
        await type(wrapper, 'notes');
        const open = vi.spyOn(window, 'open').mockReturnValue(null);

        await wrapper.get('.uinput').trigger('keydown', { key: 'ArrowDown' });
        await wrapper.get('.uinput').trigger('keydown', { key: 'Enter' });

        expect(open).toHaveBeenCalledWith('/file/f1', '_blank');
    });

    it('navigates into a highlighted folder rather than opening a tab', async () =>
    {
        const { wrapper, router } = await mountBox();
        searchMock.mockResolvedValue(envelope([ folderNode('d1', 'Team') ]));
        await type(wrapper, 'team');
        const push = vi.spyOn(router, 'push');

        await wrapper.get('.uinput').trigger('keydown', { key: 'ArrowDown' });
        await wrapper.get('.uinput').trigger('keydown', { key: 'Enter' });

        expect(push).toHaveBeenCalledWith('/folder/d1');
    });

    it('walks the rows with the arrow keys, marking one selected at a time', async () =>
    {
        const { wrapper } = await mountBox();
        searchMock.mockResolvedValue(envelope([ folderNode('d1', 'One'), folderNode('d2', 'Two') ]));
        await type(wrapper, 'wal');

        const selected = () : (string | undefined)[] =>
        {
            return wrapper.findAll('[role="option"]').map((row) => row.attributes('aria-selected'));
        };

        expect(selected()).toEqual([ 'false', 'false' ]);

        await wrapper.get('.uinput').trigger('keydown', { key: 'ArrowDown' });
        expect(selected()).toEqual([ 'true', 'false' ]);

        await wrapper.get('.uinput').trigger('keydown', { key: 'ArrowDown' });
        expect(selected()).toEqual([ 'false', 'true' ]);
    });

    // Past the last suggestion sits the "See all results" row, so arrowing off the end lands there rather than
    // wrapping straight back to the first match.
    it('reaches the see-all row past the last suggestion, then wraps to the top', async () =>
    {
        const { wrapper, router } = await mountBox();
        searchMock.mockResolvedValue(envelope([ folderNode('d1', 'One') ]));
        await type(wrapper, 'wrap');
        const push = vi.spyOn(router, 'push');

        await wrapper.get('.uinput').trigger('keydown', { key: 'ArrowDown' });
        await wrapper.get('.uinput').trigger('keydown', { key: 'ArrowDown' });
        await wrapper.get('.uinput').trigger('keydown', { key: 'Enter' });

        expect(push).toHaveBeenCalledWith({ path: '/search', query: { q: 'wrap' } });
    });

    it('puts the dropdown away on Escape without clearing what was typed', async () =>
    {
        const { wrapper } = await mountBox();
        searchMock.mockResolvedValue(envelope([ folderNode('d1', 'Notes') ]));
        await type(wrapper, 'notes');

        expect(wrapper.find('[role="listbox"]').exists()).toBe(true);

        await wrapper.get('.uinput').trigger('keydown', { key: 'Escape' });

        expect(wrapper.find('[role="listbox"]').exists()).toBe(false);
        expect(wrapper.get('.uinput').attributes('value')).toBe('notes');
    });

    // Escape only hides the list. Enter still has to run the search the caller typed.
    it('still runs the search on Enter after the dropdown was dismissed', async () =>
    {
        const { wrapper, router } = await mountBox();
        searchMock.mockResolvedValue(envelope([ folderNode('d1', 'Notes') ]));
        await type(wrapper, 'notes');
        await wrapper.get('.uinput').trigger('keydown', { key: 'Escape' });
        const push = vi.spyOn(router, 'push');

        await wrapper.get('.uinput').trigger('keydown', { key: 'Enter' });

        expect(push).toHaveBeenCalledWith({ path: '/search', query: { q: 'notes' } });
    });

    it('dismisses the dropdown when a click lands outside the box', async () =>
    {
        const { wrapper } = await mountBox();
        searchMock.mockResolvedValue(envelope([ folderNode('d1', 'Notes') ]));
        await type(wrapper, 'notes');

        expect(wrapper.find('[role="listbox"]').exists()).toBe(true);

        document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
        await flushPromises();

        expect(wrapper.find('[role="listbox"]').exists()).toBe(false);
    });

    it('opens a suggestion clicked with the pointer', async () =>
    {
        const { wrapper, router } = await mountBox();
        searchMock.mockResolvedValue(envelope([ folderNode('d1', 'Team') ]));
        await type(wrapper, 'team');
        const push = vi.spyOn(router, 'push');

        await wrapper.get('[role="option"]').trigger('mousedown');

        expect(push).toHaveBeenCalledWith('/folder/d1');
    });

    // An empty box has nothing to search for, so Enter is a no-op rather than a 400 from the server.
    it('does nothing on Enter with an empty box', async () =>
    {
        const { wrapper, router } = await mountBox();
        const push = vi.spyOn(router, 'push');

        await wrapper.get('.uinput').trigger('keydown', { key: 'Enter' });

        expect(push).not.toHaveBeenCalled();
    });
});

//----------------------------------------------------------------------------------------------------------------------
