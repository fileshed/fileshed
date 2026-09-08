//----------------------------------------------------------------------------------------------------------------------
// Search Page — query-driven load, requery on route change, facet rendering, open flows
//
// Drives the whole page against the real search surface and the real search store, mocking only the resource-access
// boundary and the router. The route's `q` param is the only input: a blank or missing term prompts rather than
// querying, a present term loads on mount, and a fresh term pushed while already on the page (the top bar's own
// submission path) re-queries in place. Each hit renders name, owner attribution from the owners facet, size,
// modified date, type, and where it lives; opening follows the same handler seam as the drive and Shared with me.
//
// Selection is the drive's, transplanted: the same gestures and the same engine deciding what a selection may do. The
// point of it here is that hits scattered across folders and owners can be dealt with where they were found, so what
// these assert is the ownership rule holding across a mixed selection -- one foreign node withholds Trash entirely
// rather than acting on the part of the selection the caller does own.
//----------------------------------------------------------------------------------------------------------------------

import { defineComponent } from 'vue';

import { type Mock, beforeEach, describe, expect, it, vi } from 'vitest';
import { type VueWrapper, flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { type Router, createMemoryHistory, createRouter } from 'vue-router';

import { MAX_SEARCH_LIMIT, type NodeLocation, type NodeResponse, type SearchResponse } from '@fileshed/core';

// Resource Access
import { copyNode, hardDeleteNode, trashNode } from '@client/resource-access/nodes.ts';
import { search } from '@client/resource-access/search.ts';

// Stores
import { useSessionStore } from '@client/stores/session.ts';

// Support
import { ME_ID, SCROLL_AREA_STUB, meFixture } from '../support.ts';

// Under test
import SearchPage from '@client/pages/searchPage.vue';

//----------------------------------------------------------------------------------------------------------------------

vi.mock('@client/resource-access/search.ts', () => ({ search: vi.fn() }));
vi.mock('@client/resource-access/nodes.ts', () => ({
    trashNode: vi.fn(),
    hardDeleteNode: vi.fn(),
    copyNode: vi.fn(),
}));
vi.mock('@client/resource-access/me.ts', () => ({ fetchMe: vi.fn() }));
vi.mock('@nuxt/ui/composables', () => ({ useToast: () => ({ add: vi.fn() }) }));

const searchMock = search as unknown as Mock;
const trashMock = trashNode as unknown as Mock;
const hardDeleteMock = hardDeleteNode as unknown as Mock;
const copyMock = copyNode as unknown as Mock;

//----------------------------------------------------------------------------------------------------------------------

const ISO = '2026-07-01T00:00:00.000Z';
const BASE = { parentID: null, createdAt: ISO, updatedAt: ISO, role: 'viewer' as const };

function fileNode(id : string, name : string, ownerID : string, mimeType = 'application/octet-stream') : NodeResponse
{
    return {
        ...BASE,
        id,
        name,
        ownerID,
        type: 'file',
        blobID: 'b1',
        size: 100,
        mimeType,
        trashedAt: null,
        sharing: null,
    };
}

function textFileNode(id : string, name : string, ownerID = 'owner1') : NodeResponse
{
    return fileNode(id, name, ownerID, 'text/plain');
}

function folderNode(id : string, name : string, ownerID = 'owner1') : NodeResponse
{
    return { sharing: null, ...BASE, id, name, ownerID, type: 'folder', trashedAt: null };
}

// Every hit needs a location, so the default is the plainest one: the caller's own files root, no folders between.
function envelope(nodes : NodeResponse[], overrides : Partial<SearchResponse> = {}) : SearchResponse
{
    const locations = Object.fromEntries(
        nodes.map((node) : [ string, NodeLocation ] => [ node.id, { crumbs: [], foreign: false } ])
    );

    return { nodes, total: nodes.length, limit: 50, offset: 0, owners: [], locations, ...overrides };
}

const STUBS = {
    UScrollArea: SCROLL_AREA_STUB,
    UButton: {
        // Declared, so the stub's own $emit is the only click the parent hears -- without it the native click
        // falls through as a second one and every action runs twice.
        emits: [ 'click' ],
        props: [ 'label', 'to', 'ariaLabel', 'disabled' ],
        template: '<button class="ubtn" :data-label="label" :data-to="to" :data-aria="ariaLabel" '
            + ':disabled="disabled" @click="$emit(\'click\')">{{ label }}</button>',
    },
    UIcon: true,
    UTooltip: { template: '<div><slot /></div>' },
    UDropdownMenu: defineComponent({
        props: { items: { type: Array, default: () => [] } },
        computed: {
            flat() : { label : string; onSelect ?: () => void }[]
            {
                return (this.items as { label : string; onSelect ?: () => void }[][]).flat();
            },
        },
        template: '<div class="menu"><button v-for="item in flat" :key="item.label" class="menu-item" '
            + '@click="item.onSelect && item.onSelect()">{{ item.label }}</button><slot /></div>',
    }),
    UAvatar: { props: [ 'src', 'alt' ], template: '<span class="avatar" :data-src="src" :data-alt="alt"></span>' },
};

// The rows are divs carrying role="button"; the stubbed UButton is a real <button> with no role attribute, so this
// picks out result rows and nothing else.
function resultRows(wrapper : VueWrapper) : ReturnType<VueWrapper['findAll']>
{
    return wrapper.findAll('[role="button"]');
}

function actionButton(wrapper : VueWrapper, label : string) : ReturnType<VueWrapper['find']>
{
    return wrapper.find(`button[data-label="${ label }"]`);
}

function downloadItems(wrapper : VueWrapper) : ReturnType<VueWrapper['findAll']>
{
    return wrapper.findAll('[data-menu="download"] .menu-item');
}

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

    useSessionStore().me = meFixture();

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

    // A search can never surface more hits than the server's candidate cap, and the endpoint serves a page that
    // large, so one request answers any search in full -- there is no second page, and no facet to merge across one.
    it('asks for the whole result set in one request, attributing every owner in it', async () =>
    {
        searchMock.mockResolvedValue(envelope(
            [ fileNode('f1', 'first-hit.txt', 'owner1'), fileNode('f2', 'second-hit.txt', 'owner2') ],
            {
                total: 2,
                owners: [
                    { id: 'owner1', name: 'Ada Lovelace', email: 'ada@example.com', image: null },
                    { id: 'owner2', name: 'Grace Hopper', email: 'grace@example.com', image: null },
                ],
            }
        ));

        const { wrapper } = await mountSearch('hit');

        expect(searchMock).toHaveBeenCalledTimes(1);
        expect(searchMock).toHaveBeenCalledWith('hit', { limit: MAX_SEARCH_LIMIT, offset: 0 });
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

        expect(wrapper.find('[data-to="/folder/quarter?select=f1"]').exists()).toBe(true);
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

        expect(wrapper.find('[data-to="/?select=f1"]').exists()).toBe(true);
    });
});

//----------------------------------------------------------------------------------------------------------------------

describe('SearchPage selection', () =>
{
    beforeEach(() =>
    {
        vi.clearAllMocks();
        trashMock.mockResolvedValue(undefined);
        hardDeleteMock.mockResolvedValue(undefined);
        copyMock.mockResolvedValue(undefined);
    });

    async function withResults(nodes : NodeResponse[]) : Promise<VueWrapper>
    {
        searchMock.mockResolvedValue(envelope(nodes));
        const { wrapper } = await mountSearch('junk');

        return wrapper;
    }

    it('shows no selection bar until something is selected', async () =>
    {
        const wrapper = await withResults([ fileNode('f1', 'a.txt', ME_ID) ]);

        expect(wrapper.text()).not.toContain('selected');
    });

    it('selects a row on a plain click', async () =>
    {
        const wrapper = await withResults([ fileNode('f1', 'a.txt', ME_ID), fileNode('f2', 'b.txt', ME_ID) ]);

        await resultRows(wrapper)[0]?.trigger('click');

        expect(wrapper.text()).toContain('1 selected');
    });

    it('replaces the selection on a plain click, and adds on ctrl-click', async () =>
    {
        const wrapper = await withResults([
            fileNode('f1', 'a.txt', ME_ID),
            fileNode('f2', 'b.txt', ME_ID),
            fileNode('f3', 'c.txt', ME_ID),
        ]);

        await resultRows(wrapper)[0]?.trigger('click');
        await resultRows(wrapper)[1]?.trigger('click');
        expect(wrapper.text()).toContain('1 selected');

        await resultRows(wrapper)[2]?.trigger('click', { ctrlKey: true });
        expect(wrapper.text()).toContain('2 selected');
    });

    // The whole point on this surface: one gesture over hits that live in different folders.
    it('takes a run of rows on shift-click', async () =>
    {
        const wrapper = await withResults([
            fileNode('f1', 'a.txt', ME_ID),
            fileNode('f2', 'b.txt', ME_ID),
            fileNode('f3', 'c.txt', ME_ID),
        ]);

        await resultRows(wrapper)[0]?.trigger('click');
        await resultRows(wrapper)[2]?.trigger('click', { shiftKey: true });

        expect(wrapper.text()).toContain('3 selected');
    });

    it('clears the selection on Escape', async () =>
    {
        const wrapper = await withResults([ fileNode('f1', 'a.txt', ME_ID) ]);
        await resultRows(wrapper)[0]?.trigger('click');
        expect(wrapper.text()).toContain('1 selected');

        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
        await flushPromises();

        expect(wrapper.text()).not.toContain('selected');
    });

    it('drops the selection when the term changes', async () =>
    {
        const wrapper = await withResults([ fileNode('f1', 'a.txt', ME_ID) ]);
        await resultRows(wrapper)[0]?.trigger('click');

        searchMock.mockResolvedValue(envelope([ fileNode('f9', 'z.txt', ME_ID) ]));
        await mountSearch('other');
        await flushPromises();

        expect(wrapper.text()).toContain('1 selected');
    });

    it('trashes every selected node and re-runs the search', async () =>
    {
        const wrapper = await withResults([ fileNode('f1', 'a.txt', ME_ID), fileNode('f2', 'b.txt', ME_ID) ]);

        await resultRows(wrapper)[0]?.trigger('click');
        await resultRows(wrapper)[1]?.trigger('click', { ctrlKey: true });
        await actionButton(wrapper, 'Trash').trigger('click');
        await flushPromises();

        expect(trashMock.mock.calls.map((call) => call[0])).toEqual([ 'f1', 'f2' ]);
        expect(searchMock).toHaveBeenCalledTimes(3);
    });

    // The rule the drive holds and this surface has more chance to meet: one node the caller does not own drops the
    // action entirely rather than acting on the part of the selection they do own.
    it('withholds Trash when one selected node belongs to somebody else', async () =>
    {
        const wrapper = await withResults([ fileNode('f1', 'a.txt', ME_ID), fileNode('f2', 'b.txt', 'someone-else') ]);

        await resultRows(wrapper)[0]?.trigger('click');
        await resultRows(wrapper)[1]?.trigger('click', { ctrlKey: true });

        expect(wrapper.text()).toContain('2 selected');
        expect(actionButton(wrapper, 'Trash').exists()).toBe(false);
    });

    // Copy asks only read access, so it is the one action a viewer's grant leaves standing -- and the reason the bar
    // is worth showing at all for a foreign hit.
    it('still offers Copy for a file the caller does not own', async () =>
    {
        const wrapper = await withResults([ fileNode('f1', 'a.txt', 'someone-else') ]);

        await resultRows(wrapper)[0]?.trigger('click');

        expect(actionButton(wrapper, 'Copy').attributes('disabled')).toBeUndefined();
    });

    // There is no open folder on this surface to copy into, so a copy lands in the caller's own root.
    it('copies into the caller\'s own root', async () =>
    {
        const wrapper = await withResults([ fileNode('f1', 'a.txt', 'someone-else') ]);

        await resultRows(wrapper)[0]?.trigger('click');
        await actionButton(wrapper, 'Copy').trigger('click');
        await flushPromises();

        expect(copyMock).toHaveBeenCalledWith('f1', { parentID: null });
    });

    it('refuses Copy for a folder', async () =>
    {
        const wrapper = await withResults([ folderNode('d1', 'Archive', ME_ID) ]);

        await resultRows(wrapper)[0]?.trigger('click');

        expect(actionButton(wrapper, 'Copy').attributes('disabled')).toBeDefined();
    });

    // Downloading asks only read access, so it is offered for a foreign hit too -- and a folder among the results
    // carries its whole tree, which is what makes a search a way to collect scattered files.
    it('downloads the selection as one archive, in the format asked for', async () =>
    {
        const opened = vi.spyOn(window, 'open').mockReturnValue(null);

        const wrapper = await withResults([
            fileNode('f1', 'a.txt', ME_ID),
            folderNode('d1', 'Archive', 'someone-else'),
        ]);

        await resultRows(wrapper)[0]?.trigger('click');
        await resultRows(wrapper)[1]?.trigger('click', { ctrlKey: true });

        const items = downloadItems(wrapper);
        expect(items.map((item) => item.text())).toEqual([ 'As .zip', 'As .tgz' ]);

        await items[1]?.trigger('click');
        await flushPromises();

        expect(opened).toHaveBeenCalledWith('/api/archives?ids=f1%2Cd1&format=tgz', '_blank');

        opened.mockRestore();
    });

    // Links carry no trashed_at, so a links-only selection is removed rather than trashed, and the button says so.
    it('removes a links-only selection instead of trashing it', async () =>
    {
        const link = { ...fileNode('l1', 'shortcut', ME_ID), type: 'link' as const, targetNodeID: 'f9', target: null };
        const wrapper = await withResults([ link as unknown as NodeResponse ]);

        await resultRows(wrapper)[0]?.trigger('click');
        expect(actionButton(wrapper, 'Remove').exists()).toBe(true);

        await actionButton(wrapper, 'Remove').trigger('click');
        await flushPromises();

        expect(hardDeleteMock).toHaveBeenCalledWith('l1');
        expect(trashMock).not.toHaveBeenCalled();
    });
});

//----------------------------------------------------------------------------------------------------------------------
