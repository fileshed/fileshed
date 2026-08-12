//----------------------------------------------------------------------------------------------------------------------
// Search Page — query-driven load, requery on route change, facet rendering, open flows
//
// Drives the whole page against the real search surface and the real search store, mocking only the resource-access
// boundary and the router. The route's `q` param is the only input: a blank or missing term prompts rather than
// querying, a present term loads on mount, and a fresh term pushed while already on the page (the top bar's own
// submission path) re-queries in place. Each hit renders name, owner attribution from the owners facet, size,
// modified date, type, and where it lives; opening follows the same handler seam as the drive and Shared with me.
//----------------------------------------------------------------------------------------------------------------------

import { type Mock, beforeEach, describe, expect, it, vi } from 'vitest';
import { type VueWrapper, flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { type Router, createMemoryHistory, createRouter } from 'vue-router';

import type { NodeLocation, NodeResponse, SearchResponse } from '@fileshed/core';

// Resource Access
import { search } from '@client/resource-access/search.ts';

// Under test
import SearchPage from '@client/pages/searchPage.vue';

//----------------------------------------------------------------------------------------------------------------------

vi.mock('@client/resource-access/search.ts', () => ({ search: vi.fn() }));

const searchMock = search as unknown as Mock;

//----------------------------------------------------------------------------------------------------------------------

const ISO = '2026-07-01T00:00:00.000Z';
const BASE = { parentID: null, createdAt: ISO, updatedAt: ISO, role: 'viewer' as const };

function fileNode(id : string, name : string, ownerID : string, mimeType = 'application/octet-stream') : NodeResponse
{
    return { ...BASE, id, name, ownerID, type: 'file', blobID: 'b1', size: 100, mimeType, trashedAt: null };
}

function textFileNode(id : string, name : string, ownerID = 'owner1') : NodeResponse
{
    return fileNode(id, name, ownerID, 'text/plain');
}

function folderNode(id : string, name : string, ownerID = 'owner1') : NodeResponse
{
    return { ...BASE, id, name, ownerID, type: 'folder', trashedAt: null };
}

// Every hit needs a location, so the default is the plainest one: the caller's own files root, no folders between.
function envelope(nodes : NodeResponse[], overrides : Partial<SearchResponse> = {}) : SearchResponse
{
    const locations = Object.fromEntries(
        nodes.map((node) : [ string, NodeLocation ] => [ node.id, { crumbs: [], foreign: false } ])
    );

    return { nodes, total: nodes.length, limit: 50, offset: 0, owners: [], locations, sharing: {}, ...overrides };
}

const STUBS = {
    UButton: {
        props: [ 'label', 'to' ],
        template: '<button class="ubtn" :data-label="label" :data-to="to" @click="$emit(\'click\')">'
            + '{{ label }}</button>',
    },
    UIcon: true,
    UAvatar: { props: [ 'src', 'alt' ], template: '<span class="avatar" :data-src="src" :data-alt="alt"></span>' },
};

async function mountSearch(query ?: string) : Promise<{ wrapper : VueWrapper; router : Router }>
{
    const pinia = createPinia();
    setActivePinia(pinia);

    const router = createRouter({
        history: createMemoryHistory(),
        routes: [
            { path: '/search', name: 'search', component: { template: '<div />' } },
            { path: '/folder/:id', name: 'folder', component: { template: '<div />' } },
            { path: '/file/:id', name: 'file', component: { template: '<div />' } },
        ],
    });
    await router.push({ path: '/search', query: query !== undefined ? { q: query } : {} });
    await router.isReady();

    const wrapper = mount(SearchPage, { global: { plugins: [ pinia, router ], stubs: STUBS } });
    await flushPromises();

    return { wrapper, router };
}

//----------------------------------------------------------------------------------------------------------------------

describe('SearchPage', () =>
{
    beforeEach(() => vi.clearAllMocks());

    it('prompts to type a search when the route carries no query, without calling search', async () =>
    {
        const { wrapper } = await mountSearch();

        expect(wrapper.text()).toContain('Type something in the search box');
        expect(searchMock).not.toHaveBeenCalled();
    });

    it('loads results for the query param on mount', async () =>
    {
        searchMock.mockResolvedValue(envelope([ fileNode('f1', 'Quarterly-Zephyr.pdf', 'owner1', 'application/pdf') ]));

        const { wrapper } = await mountSearch('zephyr');

        expect(searchMock).toHaveBeenCalledWith('zephyr', expect.objectContaining({ offset: 0 }));
        expect(wrapper.text()).toContain('Quarterly-Zephyr.pdf');
    });

    it('re-queries when a fresh term is pushed while already on the page', async () =>
    {
        searchMock.mockResolvedValue(envelope([ fileNode('f1', 'alpha-report.txt', 'owner1') ]));
        const { wrapper, router } = await mountSearch('alpha');

        expect(wrapper.text()).toContain('alpha-report.txt');

        searchMock.mockResolvedValue(envelope([ fileNode('f2', 'beta-report.txt', 'owner1') ]));
        await router.push({ path: '/search', query: { q: 'beta' } });
        await flushPromises();

        expect(searchMock).toHaveBeenLastCalledWith('beta', expect.objectContaining({ offset: 0 }));
        expect(wrapper.text()).toContain('beta-report.txt');
        expect(wrapper.text()).not.toContain('alpha-report.txt');
    });

    it('shows the result count line for the active term', async () =>
    {
        searchMock.mockResolvedValue(envelope(
            [ fileNode('f1', 'one.txt', 'owner1'), fileNode('f2', 'two.txt', 'owner1') ]
        ));

        const { wrapper } = await mountSearch('report');

        expect(wrapper.text()).toContain('2 results for "report"');
    });

    it('shows a no-results state naming the term when nothing matches', async () =>
    {
        searchMock.mockResolvedValue(envelope([]));

        const { wrapper } = await mountSearch('nothing-like-this');

        expect(wrapper.text()).toContain('No files match "nothing-like-this"');
    });

    // Search spans owners the caller never listed a folder for, so every hit's owner rides in the facet -- a foreign
    // owner renders their real name and avatar, the same as the caller's own hits do.
    it('renders a foreign owner\'s real name and avatar from the owners facet', async () =>
    {
        searchMock.mockResolvedValue(envelope(
            [ fileNode('f1', 'budget.txt', 'owner7') ],
            {
                owners: [
                    { id: 'owner7', name: 'Ada Lovelace', email: 'ada@example.com', image: '/api/avatars/deadbeef' },
                ],
            }
        ));

        const { wrapper } = await mountSearch('budget');

        expect(wrapper.text()).toContain('Ada Lovelace');
        expect(wrapper.find('[data-alt="Ada Lovelace"]').attributes('data-src')).toBe('/api/avatars/deadbeef');
    });

    // The facet is scoped to each response's own page, so loading a further page must merge its owners into the
    // running set rather than replace it -- otherwise the first page's rows would lose their attribution.
    it('keeps an earlier page\'s owner attribution after loading a further page', async () =>
    {
        searchMock.mockResolvedValueOnce(envelope(
            [ fileNode('f1', 'first-hit.txt', 'owner1') ],
            { total: 2, owners: [ { id: 'owner1', name: 'Ada Lovelace', email: 'ada@example.com', image: null } ] }
        ));
        const { wrapper } = await mountSearch('hit');

        expect(wrapper.text()).toContain('Ada Lovelace');

        searchMock.mockResolvedValueOnce(envelope(
            [ fileNode('f2', 'second-hit.txt', 'owner2') ],
            { total: 2, owners: [ { id: 'owner2', name: 'Grace Hopper', email: 'grace@example.com', image: null } ] }
        ));
        await wrapper.get('[data-label="Load more"]').trigger('click');
        await flushPromises();

        expect(wrapper.text()).toContain('Ada Lovelace');
        expect(wrapper.text()).toContain('Grace Hopper');
    });

    it('recovers from a load error via retry', async () =>
    {
        searchMock.mockRejectedValueOnce(new Error('boom'));
        const { wrapper } = await mountSearch('report');

        expect(wrapper.text()).toContain('couldn\'t run that search');

        searchMock.mockResolvedValue(envelope([ fileNode('f1', 'report.txt', 'owner1') ]));
        await wrapper.get('[data-label="Retry"]').trigger('click');
        await flushPromises();

        expect(wrapper.text()).toContain('report.txt');
    });

    it('navigates into a folder result when it is opened', async () =>
    {
        searchMock.mockResolvedValue(envelope([ folderNode('dir1', 'Team') ]));
        const { wrapper, router } = await mountSearch('team');
        const push = vi.spyOn(router, 'push');

        await wrapper.get('[aria-label="Team"]').trigger('dblclick');

        expect(push).toHaveBeenCalledWith('/folder/dir1');
    });

    it('opens a small text file result in the editor in a new tab', async () =>
    {
        searchMock.mockResolvedValue(envelope([ textFileNode('f1', 'notes.txt') ]));
        const { wrapper } = await mountSearch('notes');
        const open = vi.spyOn(window, 'open').mockReturnValue(null);

        await wrapper.get('[aria-label="notes.txt"]').trigger('dblclick');

        expect(open).toHaveBeenCalledWith('/file/f1', '_blank');
    });
});

//----------------------------------------------------------------------------------------------------------------------
// Locations — where each hit lives, and the action that goes there
//----------------------------------------------------------------------------------------------------------------------

describe('SearchPage locations', () =>
{
    beforeEach(() => vi.clearAllMocks());

    function located(node : NodeResponse, location : NodeLocation) : SearchResponse
    {
        return envelope([ node ], { locations: { [node.id]: location } });
    }

    // A search result out of context is barely useful -- the whole point is learning where the thing lives, anchored
    // the same way the drive's breadcrumb anchors it.
    it('renders an own-tree hit\'s location under the caller\'s files root', async () =>
    {
        const node = { ...fileNode('f1', 'budget.txt', 'owner1'), parentID: 'quarter' };
        searchMock.mockResolvedValue(located(node, {
            crumbs: [ { id: 'projects', name: 'Projects' }, { id: 'quarter', name: 'Q3' } ],
            foreign: false,
        }));

        const { wrapper } = await mountSearch('budget');

        expect(wrapper.text()).toContain('My Files');
        expect(wrapper.text()).toContain('Projects');
        expect(wrapper.text()).toContain('Q3');
    });

    // A hit reached through a share roots under Shared with me, not the caller's own files -- claiming otherwise would
    // tell them a file of someone else's lives in their drive.
    it('anchors a foreign hit under Shared with me rather than the caller\'s files root', async () =>
    {
        const node = { ...fileNode('f1', 'budget.txt', 'owner9'), parentID: 'team' };
        searchMock.mockResolvedValue(located(node, {
            crumbs: [ { id: 'team', name: 'Team Docs' } ],
            foreign: true,
        }));

        const { wrapper } = await mountSearch('budget');

        expect(wrapper.text()).toContain('Shared with me');
        expect(wrapper.text()).toContain('Team Docs');
        expect(wrapper.text()).not.toContain('My Files');
    });

    // The action lands on the containing folder AND names the hit, so the caller arrives already pointed at the file
    // they went looking for rather than hunting for it again in a full folder.
    it('offers a go-to-folder action targeting the containing folder with the hit selected', async () =>
    {
        const node = { ...fileNode('f1', 'budget.txt', 'owner1'), parentID: 'quarter' };
        searchMock.mockResolvedValue(located(node, {
            crumbs: [ { id: 'quarter', name: 'Q3' } ],
            foreign: false,
        }));

        const { wrapper } = await mountSearch('budget');

        expect(wrapper.get('[data-to="/folder/quarter?select=f1"]').exists()).toBe(true);
    });

    // A hit whose parent the caller cannot resolve has no folder to open -- offering the action anyway would navigate
    // them into a 404.
    it('withholds the action when the containing folder is out of the caller\'s reach', async () =>
    {
        const node = { ...fileNode('f1', 'budget.txt', 'owner9'), parentID: 'hidden' };
        searchMock.mockResolvedValue(located(node, { crumbs: [], foreign: true }));

        const { wrapper } = await mountSearch('budget');

        expect(wrapper.findAll('[data-to]').filter((button) => button.attributes('data-to') !== undefined))
            .toHaveLength(0);
    });

    // A hit at the caller's own root still has somewhere to go: their files root.
    it('sends a hit at the caller\'s own root to the files root', async () =>
    {
        searchMock.mockResolvedValue(located(fileNode('f1', 'budget.txt', 'owner1'), {
            crumbs: [],
            foreign: false,
        }));

        const { wrapper } = await mountSearch('budget');

        expect(wrapper.get('[data-to="/?select=f1"]').exists()).toBe(true);
    });
});

//----------------------------------------------------------------------------------------------------------------------
