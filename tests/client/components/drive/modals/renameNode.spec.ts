//----------------------------------------------------------------------------------------------------------------------
// Rename Modal — imperative single-node rename
//----------------------------------------------------------------------------------------------------------------------

import { type Mock, beforeEach, describe, expect, it, vi } from 'vitest';
import { type VueWrapper, flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';

import type { NodeListResponse, NodeResponse } from '@fileshed/core';

// Resource Access
import { listChildren, patchNode } from '@client/resource-access/nodes.ts';

// Support
import { fileNode } from '../../../support.ts';

// Under test
import RenameNode from '@client/components/drive/modals/renameNode.vue';

//----------------------------------------------------------------------------------------------------------------------

const toastAdd = vi.hoisted(() => vi.fn());

vi.mock('@client/resource-access/nodes.ts', () => ({
    listChildren: vi.fn(),
    patchNode: vi.fn(),
}));

vi.mock('@nuxt/ui/composables', () => ({ useToast: () => ({ add: toastAdd }) }));

const listChildrenMock = listChildren as unknown as Mock;
const patchNodeMock = patchNode as unknown as Mock;

//----------------------------------------------------------------------------------------------------------------------

interface Openable { open : (node : NodeResponse) => void }

function emptyPage() : NodeListResponse
{
    return { nodes: [], total: 0, limit: 50, offset: 0, owners: [] };
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
        listChildrenMock.mockResolvedValue(emptyPage());
    });

    it('opens prefilled with the node\'s current name', async () =>
    {
        const wrapper = mountModal();

        await open(wrapper, fileNode({ id: 'f1', name: 'current.txt' }));

        expect(field(wrapper, 'data-open')).toBe('true');
        expect(field(wrapper, 'data-initial')).toBe('current.txt');
    });

    it('patches the target to the entered name, then closes', async () =>
    {
        const wrapper = mountModal();
        await open(wrapper, fileNode({ id: 'f1', name: 'current.txt' }));

        await submit(wrapper, 'renamed.txt');

        expect(patchNodeMock).toHaveBeenCalledWith('f1', { name: 'renamed.txt' });
        expect(field(wrapper, 'data-open')).toBe('false');
    });

    it('keeps the modal open and toasts when the rename fails', async () =>
    {
        patchNodeMock.mockRejectedValue(new Error('boom'));
        const wrapper = mountModal();
        await open(wrapper, fileNode({ id: 'f1', name: 'current.txt' }));

        await submit(wrapper, 'renamed.txt');

        expect(toastAdd).toHaveBeenCalledWith(expect.objectContaining({ color: 'error' }));
        expect(field(wrapper, 'data-open')).toBe('true');
    });
});

//----------------------------------------------------------------------------------------------------------------------
