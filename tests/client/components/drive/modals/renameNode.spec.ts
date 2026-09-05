//----------------------------------------------------------------------------------------------------------------------
// Rename Modal — imperative single-node rename
//----------------------------------------------------------------------------------------------------------------------

import { type Mock, beforeEach, describe, expect, it, vi } from 'vitest';
import { type VueWrapper, flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';

import type { NodeListResponse, NodeResponse } from '@fileshed/core';

// Resource Access
import { getChildren, patchNode } from '@client/resource-access/nodes.ts';

// Under test
import RenameNode from '@client/components/drive/modals/renameNode.vue';

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

interface Openable { open : (node : NodeResponse) => void }

function emptyPage() : NodeListResponse
{
    return { nodes: [], total: 0, limit: 50, offset: 0, owners: [] };
}

function fileNode(id : string, name : string) : NodeResponse
{
    return {
        sharing: null,
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

const NameDialogStub = {
    name: 'NameDialog',
    props: [ 'open', 'title', 'initial', 'pending' ],
    emits: [ 'submit', 'update:open' ],
    template: '<div class="name-dialog" :data-open="String(open)" :data-initial="initial" />',
};

function mountModal() : VueWrapper
{
    return mount(RenameNode, { global: { stubs: { NameDialog: NameDialogStub } } });
}

async function open(wrapper : VueWrapper, node : NodeResponse) : Promise<void>
{
    (wrapper.vm as unknown as Openable).open(node);

    await flushPromises();
}

function field(wrapper : VueWrapper, name : string) : string | undefined
{
    return wrapper.find('.name-dialog').attributes(name);
}

async function submit(wrapper : VueWrapper, name : string) : Promise<void>
{
    wrapper.findComponent({ name: 'NameDialog' }).vm.$emit('submit', name);

    await flushPromises();
}

//----------------------------------------------------------------------------------------------------------------------

describe('RenameNode modal', () =>
{
    beforeEach(() =>
    {
        setActivePinia(createPinia());
        vi.clearAllMocks();
        getChildrenMock.mockResolvedValue(emptyPage());
    });

    it('opens prefilled with the node\'s current name', async () =>
    {
        const wrapper = mountModal();

        await open(wrapper, fileNode('f1', 'current.txt'));

        expect(field(wrapper, 'data-open')).toBe('true');
        expect(field(wrapper, 'data-initial')).toBe('current.txt');
    });

    it('patches the target to the entered name, then closes', async () =>
    {
        const wrapper = mountModal();
        await open(wrapper, fileNode('f1', 'current.txt'));

        await submit(wrapper, 'renamed.txt');

        expect(patchNodeMock).toHaveBeenCalledWith('f1', { name: 'renamed.txt' });
        expect(field(wrapper, 'data-open')).toBe('false');
    });

    it('keeps the modal open and toasts when the rename fails', async () =>
    {
        patchNodeMock.mockRejectedValue(new Error('boom'));
        const wrapper = mountModal();
        await open(wrapper, fileNode('f1', 'current.txt'));

        await submit(wrapper, 'renamed.txt');

        expect(toastAdd).toHaveBeenCalledWith(expect.objectContaining({ color: 'error' }));
        expect(field(wrapper, 'data-open')).toBe('true');
    });
});

//----------------------------------------------------------------------------------------------------------------------
