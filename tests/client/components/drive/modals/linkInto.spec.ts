//----------------------------------------------------------------------------------------------------------------------
// Link Into Modal — pointing at something you already have selected
//
// The other half of the same act: the target is known and the dialog asks where the pointer goes. What matters here
// is the empty moving set -- a link conducts nothing, so none of the move engine's cycle restrictions apply and every
// folder the caller owns is a legal destination, root included.
//----------------------------------------------------------------------------------------------------------------------

import { type Mock, beforeEach, describe, expect, it, vi } from 'vitest';
import { type VueWrapper, flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';

import type { NodeListResponse, NodeResponse } from '@fileshed/core';

// Resource Access
import { createNode, getChildren } from '@client/resource-access/nodes.ts';

// Under test
import LinkInto from '@client/components/drive/modals/linkInto.vue';

//----------------------------------------------------------------------------------------------------------------------

const toastAdd = vi.hoisted(() => vi.fn());

vi.mock('@client/resource-access/nodes.ts', () => ({
    createNode: vi.fn(),
    getChildren: vi.fn(),
    getNode: vi.fn(),
}));

vi.mock('@nuxt/ui/composables', () => ({ useToast: () => ({ add: toastAdd }) }));

const createNodeMock = createNode as unknown as Mock;
const getChildrenMock = getChildren as unknown as Mock;

//----------------------------------------------------------------------------------------------------------------------

const ISO = '2026-07-01T00:00:00.000Z';
const BASE = { sharing: null, ownerID: 'u1', parentID: null, createdAt: ISO, updatedAt: ISO, role: 'owner' as const };

function emptyPage() : NodeListResponse
{
    return { nodes: [], total: 0, limit: 50, offset: 0, owners: [] };
}

function fileNode(id : string, name = id) : NodeResponse
{
    return { ...BASE, id, name, type: 'file', blobID: 'b1', size: 10, mimeType: 'text/plain', trashedAt: null };
}

const FolderPickerStub = {
    name: 'FolderPicker',
    props: {
        movingNodeIDs: { type: Array, default: () => [] },
        pending: { type: Boolean, default: false },
        verb: { type: String, default: '' },
    },
    emits: [ 'confirm', 'cancel' ],
    template: '<div class="picker" :data-verb="verb" :data-moving="movingNodeIDs.length" />',
};

const UModalStub = {
    name: 'UModal',
    props: [ 'open', 'title' ],
    template: '<div class="modal" :data-open="String(open)" :data-title="title"><slot name="body" /></div>',
};

interface ModalHandle { open : (node : NodeResponse) => void }

async function openFor(node : NodeResponse) : Promise<VueWrapper>
{
    const wrapper = mount(LinkInto, {
        global: { stubs: { FolderPicker: FolderPickerStub, UModal: UModalStub } },
    });

    (wrapper.vm as unknown as ModalHandle).open(node);
    await flushPromises();

    return wrapper;
}

async function confirm(wrapper : VueWrapper, destination : string | null) : Promise<void>
{
    wrapper.findComponent(FolderPickerStub).vm.$emit('confirm', destination);

    await flushPromises();
}

//----------------------------------------------------------------------------------------------------------------------

describe('LinkInto modal', () =>
{
    beforeEach(() =>
    {
        setActivePinia(createPinia());
        vi.clearAllMocks();
        getChildrenMock.mockResolvedValue(emptyPage());
        createNodeMock.mockResolvedValue(fileNode('new'));
    });

    it('names the node the link will point at', async () =>
    {
        const wrapper = await openFor(fileNode('f1', 'budget.xlsx'));

        expect(wrapper.find('.modal').attributes('data-title')).toBe('Add a link to "budget.xlsx"');
    });

    // A link carries none of the move engine's cycle restrictions, because it conducts nothing: every folder the
    // caller owns is a destination, the root included.
    it('restricts no destination, the way a move would', async () =>
    {
        const wrapper = await openFor(fileNode('f1'));

        expect(wrapper.find('.picker').attributes('data-moving')).toBe('0');
        expect(wrapper.find('.picker').attributes('data-verb')).toBe('Link');
    });

    it('places the link in the chosen folder', async () =>
    {
        const wrapper = await openFor(fileNode('f1'));

        await confirm(wrapper, 'd9');

        expect(createNodeMock).toHaveBeenCalledWith({ type: 'link', targetNodeID: 'f1', parentID: 'd9' });
        expect(wrapper.find('.modal').attributes('data-open')).toBe('false');
    });

    it('places it at the root when the root is chosen', async () =>
    {
        const wrapper = await openFor(fileNode('f1'));

        await confirm(wrapper, null);

        expect(createNodeMock).toHaveBeenCalledWith({ type: 'link', targetNodeID: 'f1', parentID: null });
    });

    it('stays open and toasts when the placement is refused', async () =>
    {
        createNodeMock.mockRejectedValue(new Error('nope'));
        const wrapper = await openFor(fileNode('f1'));

        await confirm(wrapper, 'd9');

        expect(wrapper.find('.modal').attributes('data-open')).toBe('true');
        expect(toastAdd).toHaveBeenCalled();
    });
});

//----------------------------------------------------------------------------------------------------------------------
