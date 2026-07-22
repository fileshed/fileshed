//----------------------------------------------------------------------------------------------------------------------
// Move Modal — imperative one-or-many move
//----------------------------------------------------------------------------------------------------------------------

import { type Mock, beforeEach, describe, expect, it, vi } from 'vitest';
import { type VueWrapper, flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';

import type { NodeListResponse, NodeResponse } from '@fileshed/core';

// Resource Access
import { getChildren, patchNode } from '@client/resource-access/nodes.ts';

// Under test
import MoveNodes from '@client/components/drive/modals/moveNodes.vue';

//----------------------------------------------------------------------------------------------------------------------

const toastAdd = vi.hoisted(() => vi.fn());

vi.mock('@client/resource-access/nodes.ts', () => ({
    getChildren: vi.fn(),
    patchNode: vi.fn(),
}));

vi.mock('@nuxt/ui/composables', () => ({ useToast: () => ({ add: toastAdd }) }));

const getChildrenMock = getChildren as unknown as Mock;
const patchNodeMock = patchNode as unknown as Mock;

//----------------------------------------------------------------------------------------------------------------------

const ISO = '2026-07-01T00:00:00.000Z';

interface Openable { open : (nodes : NodeResponse[]) => void }

function emptyPage() : NodeListResponse
{
    return { nodes: [], total: 0, limit: 50, offset: 0, owners: [] };
}

function fileNode(id : string, name : string = id) : NodeResponse
{
    return {
        id,
        name,
        ownerID: 'u1',
        parentID: null,
        createdAt: ISO,
        updatedAt: ISO,
        role: 'owner',
        type: 'file',
        blobID: 'b1',
        size: 100,
        mimeType: 'text/plain',
        trashedAt: null,
    };
}

// UModal and FolderPicker are the presentational primitives the modal wraps; the modal stub renders the picker in the
// body slot and surfaces the modal's title and open flag.
const UModalStub = {
    props: [ 'open', 'title' ],
    template: '<div class="umodal" :data-open="String(open)" :data-title="title"><slot name="body" /></div>',
};

const FolderPickerStub = {
    name: 'FolderPicker',
    props: [ 'movingNodeIDs', 'pending' ],
    emits: [ 'confirm', 'cancel' ],
    template: '<div class="folder-picker" :data-count="movingNodeIDs.length" />',
};

function mountModal() : VueWrapper
{
    return mount(MoveNodes, { global: { stubs: { UModal: UModalStub, FolderPicker: FolderPickerStub } } });
}

function open(wrapper : VueWrapper, nodes : NodeResponse[]) : Promise<void>
{
    (wrapper.vm as unknown as Openable).open(nodes);

    return flushPromises();
}

function attr(wrapper : VueWrapper, selector : string, name : string) : string | undefined
{
    return wrapper.find(selector).attributes(name);
}

function confirm(wrapper : VueWrapper, destination : string | null) : Promise<void>
{
    wrapper.findComponent({ name: 'FolderPicker' }).vm.$emit('confirm', destination);

    return flushPromises();
}

//----------------------------------------------------------------------------------------------------------------------

describe('MoveNodes modal', () =>
{
    beforeEach(() =>
    {
        setActivePinia(createPinia());
        vi.clearAllMocks();
        getChildrenMock.mockResolvedValue(emptyPage());
    });

    it('opens titled for a single node and drives the picker for it', async () =>
    {
        const wrapper = mountModal();

        await open(wrapper, [ fileNode('f1', 'a.txt') ]);

        expect(attr(wrapper, '.umodal', 'data-open')).toBe('true');
        expect(attr(wrapper, '.umodal', 'data-title')).toBe('Move "a.txt"');
        expect(attr(wrapper, '.folder-picker', 'data-count')).toBe('1');
    });

    it('titles for a multi-node move by count', async () =>
    {
        const wrapper = mountModal();

        await open(wrapper, [ fileNode('f1'), fileNode('f2'), fileNode('f3') ]);

        expect(attr(wrapper, '.umodal', 'data-title')).toBe('Move 3 items');
    });

    it('moves every target into the chosen destination, then closes', async () =>
    {
        const wrapper = mountModal();
        await open(wrapper, [ fileNode('f1'), fileNode('f2') ]);

        await confirm(wrapper, 'dest1');

        expect(patchNodeMock).toHaveBeenCalledWith('f1', { parentID: 'dest1' });
        expect(patchNodeMock).toHaveBeenCalledWith('f2', { parentID: 'dest1' });
        expect(patchNodeMock).toHaveBeenCalledTimes(2);
        expect(attr(wrapper, '.umodal', 'data-open')).toBe('false');
    });

    it('keeps the modal open and toasts when a move fails', async () =>
    {
        patchNodeMock.mockRejectedValue(new Error('boom'));
        const wrapper = mountModal();
        await open(wrapper, [ fileNode('f1') ]);

        await confirm(wrapper, 'dest1');

        expect(toastAdd).toHaveBeenCalledWith(expect.objectContaining({ color: 'error' }));
        expect(attr(wrapper, '.umodal', 'data-open')).toBe('true');
    });
});

//----------------------------------------------------------------------------------------------------------------------
