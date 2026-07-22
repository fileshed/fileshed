//----------------------------------------------------------------------------------------------------------------------
// Drive Page — two-row header, selection bar, and modal wiring
//----------------------------------------------------------------------------------------------------------------------

import { type Mock, beforeEach, describe, expect, it, vi } from 'vitest';
import { type VueWrapper, flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { createMemoryHistory, createRouter } from 'vue-router';

import type { LinkTarget, NodeListResponse, NodeResponse } from '@fileshed/core';

// Resource Access
import { getChildren } from '@client/resource-access/nodes.ts';

// Under test
import DrivePage from '@client/pages/drivePage.vue';

//----------------------------------------------------------------------------------------------------------------------

vi.mock('@client/resource-access/nodes.ts', () => ({
    getChildren: vi.fn(),
    getNode: vi.fn(),
    createNode: vi.fn(),
    patchNode: vi.fn(),
    trashNode: vi.fn(),
    copyNode: vi.fn(),
    hardDeleteNode: vi.fn(),
}));

vi.mock('@nuxt/ui/composables', () => ({ useToast: () => ({ add: vi.fn() }) }));

const getChildrenMock = getChildren as unknown as Mock;

// Rename and Move are opened imperatively by the page; these stubs record the open(...) call so the selection-bar
// wiring (the same path the context menu funnels through) is observable.
const renameOpen = vi.fn();
const moveOpen = vi.fn();

//----------------------------------------------------------------------------------------------------------------------

const ISO = '2026-07-01T00:00:00.000Z';

const BASE = { ownerID: 'u1', parentID: null, createdAt: ISO, updatedAt: ISO, role: 'owner' as const };

function fileNode(id : string) : NodeResponse
{
    return { ...BASE, id, name: id, type: 'file', blobID: 'b1', size: 100, mimeType: 'text/plain', trashedAt: null };
}

function folderNode(id : string) : NodeResponse
{
    return { ...BASE, id, name: id, type: 'folder', trashedAt: null };
}

function linkNode(id : string, target : LinkTarget = { id: 't1', type: 'file', name: 'x' }) : NodeResponse
{
    return { ...BASE, id, name: id, type: 'link', targetNodeID: 't1', target };
}

function page(nodes : NodeResponse[]) : NodeListResponse
{
    return { nodes, total: nodes.length, limit: 50, offset: 0, owners: [] };
}

const PLAIN_CLICK = { metaKey: false, ctrlKey: false, shiftKey: false };
const TOGGLE_CLICK = { metaKey: true, ctrlKey: false, shiftKey: false };

// UButton renders its label as text; aria-label and disabled fall through as attributes so the action buttons stay
// queryable. The four modals are stubbed away -- their own specs cover them; here Rename/Move expose an open spy.
const STUBS = {
    UButton: { props: [ 'label' ], template: '<button class="ubtn" @click="$emit(\'click\')">{{ label }}</button>' },
    UTooltip: { template: '<div><slot /></div>' },
    UFieldGroup: { template: '<div><slot /></div>' },
    UDropdownMenu: { template: '<div><slot /></div>' },
    UBreadcrumb: { template: '<nav class="crumbs" />' },
    UIcon: true,
    RenameNode: {
        name: 'RenameNode',
        setup(_props : unknown, { expose } : { expose : (api : unknown) => void }) : () => null
        {
            expose({ open: renameOpen });

            return () => null;
        },
    },
    MoveNodes: {
        name: 'MoveNodes',
        setup(_props : unknown, { expose } : { expose : (api : unknown) => void }) : () => null
        {
            expose({ open: moveOpen });

            return () => null;
        },
    },
    NewFolder: true,
    NewDocument: true,
    FilterBar: { name: 'FilterBar', template: '<div class="filter-bar" />' },
    NodeList: true,
    NodeGrid: { name: 'NodeGrid', template: '<div class="node-grid" />' },
};

async function mountDrive(nodes : NodeResponse[]) : Promise<VueWrapper>
{
    getChildrenMock.mockResolvedValue(page(nodes));

    const pinia = createPinia();
    setActivePinia(pinia);

    const router = createRouter({
        history: createMemoryHistory(),
        routes: [
            { path: '/', name: 'drive', component: { template: '<div />' } },
            { path: '/folder/:id', name: 'folder', component: { template: '<div />' } },
        ],
    });
    router.push('/');
    await router.isReady();

    const wrapper = mount(DrivePage, { global: { plugins: [ pinia, router ], stubs: STUBS } });
    await flushPromises();

    return wrapper;
}

function select(wrapper : VueWrapper, node : NodeResponse, modifiers = PLAIN_CLICK) : Promise<void>
{
    wrapper.findComponent({ name: 'NodeGrid' }).vm.$emit('select', node, modifiers);

    return flushPromises();
}

//----------------------------------------------------------------------------------------------------------------------

describe('DrivePage — action row', () =>
{
    beforeEach(() => vi.clearAllMocks());

    it('shows the filter bar and the view toggle, with no selection bar, when idle', async () =>
    {
        const wrapper = await mountDrive([ fileNode('f1'), folderNode('d1') ]);

        expect(wrapper.find('.filter-bar').exists()).toBe(true);
        expect(wrapper.find('[aria-label="Grid view"]').exists()).toBe(true);
        expect(wrapper.find('[aria-label="List view"]').exists()).toBe(true);
        expect(wrapper.text()).not.toContain('selected');
        expect(wrapper.find('[aria-label="Move"]').exists()).toBe(false);
    });

    it('swaps the filter bar out for the selection bar once a selection is active', async () =>
    {
        const wrapper = await mountDrive([ fileNode('f1') ]);
        expect(wrapper.find('.filter-bar').exists()).toBe(true);

        await select(wrapper, fileNode('f1'));

        expect(wrapper.find('.filter-bar').exists()).toBe(false);
        expect(wrapper.text()).toContain('1 selected');
    });
});

//----------------------------------------------------------------------------------------------------------------------

describe('DrivePage — selection bar', () =>
{
    beforeEach(() => vi.clearAllMocks());

    it('keeps the breadcrumb and view toggle visible once a selection is active', async () =>
    {
        const wrapper = await mountDrive([ fileNode('f1') ]);

        await select(wrapper, fileNode('f1'));

        expect(wrapper.find('nav.crumbs').exists()).toBe(true);
        expect(wrapper.find('[aria-label="Grid view"]').exists()).toBe(true);
        expect(wrapper.find('[aria-label="List view"]').exists()).toBe(true);
    });

    it('swaps the sort control for the selection bar, with icon-and-text actions', async () =>
    {
        const wrapper = await mountDrive([ fileNode('f1') ]);

        await select(wrapper, fileNode('f1'));

        expect(wrapper.text()).toContain('1 selected');
        expect(wrapper.find('[aria-label="Move"]').exists()).toBe(true);
        // The action buttons carry their text label, not icon-only.
        expect(wrapper.find('[aria-label="Move"]').text()).toBe('Move');
        expect(wrapper.find('[aria-label="Copy"]').text()).toBe('Copy');
        expect(wrapper.find('[aria-label="Trash"]').text()).toBe('Trash');
    });

    it('offers Rename only for a single selection', async () =>
    {
        const wrapper = await mountDrive([ fileNode('f1'), fileNode('f2') ]);

        await select(wrapper, fileNode('f1'));
        expect(wrapper.find('[aria-label="Rename"]').exists()).toBe(true);

        await select(wrapper, fileNode('f2'), TOGGLE_CLICK);
        expect(wrapper.text()).toContain('2 selected');
        expect(wrapper.find('[aria-label="Rename"]').exists()).toBe(false);
    });

    it('disables Copy when the selection includes a non-file, enables it for files only', async () =>
    {
        const wrapper = await mountDrive([ fileNode('f1'), folderNode('d1') ]);

        await select(wrapper, fileNode('f1'));
        expect(wrapper.find('[aria-label="Copy"]').attributes('disabled')).toBeUndefined();

        await select(wrapper, folderNode('d1'), TOGGLE_CLICK);
        expect(wrapper.find('[aria-label="Copy"]').attributes('disabled')).toBeDefined();
    });

    it('labels the destructive action Trash for files and folders, Remove for a links-only selection', async () =>
    {
        const files = await mountDrive([ fileNode('f1') ]);
        await select(files, fileNode('f1'));
        expect(files.find('[aria-label="Trash"]').exists()).toBe(true);
        expect(files.find('[aria-label="Remove"]').exists()).toBe(false);

        const links = await mountDrive([ linkNode('l1') ]);
        await select(links, linkNode('l1'));
        expect(links.find('[aria-label="Remove"]').exists()).toBe(true);
        expect(links.find('[aria-label="Trash"]').exists()).toBe(false);
    });
});

//----------------------------------------------------------------------------------------------------------------------

describe('DrivePage — rename and move wiring', () =>
{
    beforeEach(() => vi.clearAllMocks());

    it('opens the rename modal for the single selected node', async () =>
    {
        const node = fileNode('f1');
        const wrapper = await mountDrive([ node ]);
        await select(wrapper, node);

        await wrapper.find('[aria-label="Rename"]').trigger('click');

        expect(renameOpen).toHaveBeenCalledWith(node);
    });

    it('opens the move modal for the whole selection', async () =>
    {
        const f1 = fileNode('f1');
        const f2 = fileNode('f2');
        const wrapper = await mountDrive([ f1, f2 ]);
        await select(wrapper, f1);
        await select(wrapper, f2, TOGGLE_CLICK);

        await wrapper.find('[aria-label="Move"]').trigger('click');

        expect(moveOpen).toHaveBeenCalledWith([ f1, f2 ]);
    });
});

//----------------------------------------------------------------------------------------------------------------------
