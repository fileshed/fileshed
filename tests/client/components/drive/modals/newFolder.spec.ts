//----------------------------------------------------------------------------------------------------------------------
// New Folder Modal — self-subscribed folder creation
//----------------------------------------------------------------------------------------------------------------------

import { type Mock, beforeEach, describe, expect, it, vi } from 'vitest';
import { type VueWrapper, flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';

import type { NodeListResponse, NodeResponse } from '@fileshed/core';

// Resource Access
import { createNode, getChildren, getNode } from '@client/resource-access/nodes.ts';

// Stores
import { useDriveStore } from '@client/stores/drive.ts';
import { useNewItemStore } from '@client/stores/newItem.ts';

// Under test
import NewFolder from '@client/components/drive/modals/newFolder.vue';

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
const getNodeMock = getNode as unknown as Mock;

//----------------------------------------------------------------------------------------------------------------------

const ISO = '2026-07-01T00:00:00.000Z';

function emptyPage() : NodeListResponse
{
    return { nodes: [], total: 0, limit: 50, offset: 0, owners: [] };
}

function folderNode(id : string) : NodeResponse
{
    return {
        sharing: null,
        id,
        name: id,
        ownerID: 'u1',
        parentID: null,
        createdAt: ISO,
        updatedAt: ISO,
        role: 'owner',
        type: 'folder',
        trashedAt: null,
    };
}

// NameDialog is the primitive the modal wraps; the stub exposes its open flag and emits the entered name.
const NameDialogStub = {
    name: 'NameDialog',
    props: [ 'open', 'title', 'initial', 'pending' ],
    emits: [ 'submit', 'update:open' ],
    template: '<div class="name-dialog" :data-open="String(open)" />',
};

function mountModal() : VueWrapper
{
    return mount(NewFolder, { global: { stubs: { NameDialog: NameDialogStub } } });
}

function isOpen(wrapper : VueWrapper) : string | undefined
{
    return wrapper.find('.name-dialog').attributes('data-open');
}

async function submit(wrapper : VueWrapper, name : string) : Promise<void>
{
    wrapper.findComponent({ name: 'NameDialog' }).vm.$emit('submit', name);

    await flushPromises();
}

//----------------------------------------------------------------------------------------------------------------------

describe('NewFolder modal', () =>
{
    beforeEach(() =>
    {
        setActivePinia(createPinia());
        vi.clearAllMocks();
        getChildrenMock.mockResolvedValue(emptyPage());
        getNodeMock.mockResolvedValue(folderNode('parent1'));
    });

    it('opens the prompt when a folder create request arrives', async () =>
    {
        const wrapper = mountModal();
        expect(isOpen(wrapper)).toBe('false');

        useNewItemStore().requestNew('folder');
        await flushPromises();

        expect(isOpen(wrapper)).toBe('true');
    });

    it('leaves a request of another kind untouched for that kind\'s modal', async () =>
    {
        const wrapper = mountModal();

        useNewItemStore().requestNew('markdown');
        await flushPromises();

        expect(isOpen(wrapper)).toBe('false');
        expect(useNewItemStore().request).not.toBeNull();
    });

    it('creates the folder in the currently open folder, then closes', async () =>
    {
        const wrapper = mountModal();
        await useDriveStore().load('parent1');

        useNewItemStore().requestNew('folder');
        await flushPromises();
        await submit(wrapper, 'Reports');

        expect(createNodeMock).toHaveBeenCalledWith({ type: 'folder', name: 'Reports', parentID: 'parent1' });
        expect(isOpen(wrapper)).toBe('false');
    });

    it('keeps the modal open and toasts when the create fails', async () =>
    {
        createNodeMock.mockRejectedValue(new Error('boom'));
        const wrapper = mountModal();

        useNewItemStore().requestNew('folder');
        await flushPromises();
        await submit(wrapper, 'Reports');

        expect(toastAdd).toHaveBeenCalledWith(expect.objectContaining({ color: 'error' }));
        expect(isOpen(wrapper)).toBe('true');
    });
});

//----------------------------------------------------------------------------------------------------------------------
