//----------------------------------------------------------------------------------------------------------------------
// New Link Modal — pointing at something from the folder you are standing in
//
// The destination is wherever the caller already is; what the dialog asks for is the target. Both kinds of target are
// pickable, since a link points at a folder as readily as at a file, and the two are reached differently: a file by
// its row, a folder by the button beside the row that would otherwise only navigate into it.
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
import NewLink from '@client/components/drive/modals/newLink.vue';

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
const BASE = { sharing: null, ownerID: 'u1', parentID: null, createdAt: ISO, updatedAt: ISO, role: 'owner' as const };

function emptyPage() : NodeListResponse
{
    return { nodes: [], total: 0, limit: 50, offset: 0, owners: [] };
}

function folderNode(id : string) : NodeResponse
{
    return { ...BASE, id, name: id, type: 'folder', trashedAt: null };
}

function fileNode(id : string) : NodeResponse
{
    return { ...BASE, id, name: id, type: 'file', blobID: 'b1', size: 10, mimeType: 'text/plain', trashedAt: null };
}

// The picker is exercised on its own; here it only has to report what the host asked of it and hand back a pick.
const FilePickerStub = {
    name: 'FilePicker',

    // folderAddable is typed, not merely named: an untyped prop receives the boolean shorthand as an empty string,
    // and the assertion below would then be about Vue's casting rather than about the host.
    props: {
        accept: { type: Array, default: () => [] },
        pending: { type: Boolean, default: false },
        folderAddable: { type: Boolean, default: false },
        folderActionLabel: { type: String, default: '' },
        folderActionIcon: { type: String, default: '' },
        caption: { type: String, default: '' },
    },
    emits: [ 'select', 'select-folder', 'cancel' ],
    template: '<div class="picker" :data-accept="accept.join(\',\')" '
        + ':data-folder-addable="String(folderAddable)" :data-folder-label="folderActionLabel" />',
};

const UModalStub = {
    name: 'UModal',
    props: [ 'open', 'title' ],
    template: '<div class="modal" :data-open="String(open)" :data-title="title"><slot name="body" /></div>',
};

function mountModal() : VueWrapper
{
    return mount(NewLink, { global: { stubs: { FilePicker: FilePickerStub, UModal: UModalStub } } });
}

function isOpen(wrapper : VueWrapper) : string | undefined
{
    return wrapper.find('.modal').attributes('data-open');
}

async function pick(wrapper : VueWrapper, event : string, node : NodeResponse) : Promise<void>
{
    wrapper.findComponent(FilePickerStub).vm.$emit(event, node);

    await flushPromises();
}

//----------------------------------------------------------------------------------------------------------------------

describe('NewLink modal', () =>
{
    beforeEach(() =>
    {
        setActivePinia(createPinia());
        vi.clearAllMocks();
        getChildrenMock.mockResolvedValue(emptyPage());
        getNodeMock.mockResolvedValue(folderNode('parent1'));
        createNodeMock.mockResolvedValue(fileNode('new'));
    });

    it('opens when a link request arrives', async () =>
    {
        const wrapper = mountModal();
        expect(isOpen(wrapper)).toBe('false');

        useNewItemStore().requestNew('link');
        await flushPromises();

        expect(isOpen(wrapper)).toBe('true');
    });

    it('leaves a request of another kind untouched for that kind\'s modal', async () =>
    {
        const wrapper = mountModal();

        useNewItemStore().requestNew('folder');
        await flushPromises();

        expect(isOpen(wrapper)).toBe('false');
        expect(useNewItemStore().request).not.toBeNull();
    });

    // A link points at whatever the caller can read, so narrowing the pick would only hide what the server accepts.
    it('constrains the pick to nothing, and offers folders as targets in their own right', async () =>
    {
        const wrapper = mountModal();
        useNewItemStore().requestNew('link');
        await flushPromises();

        const picker = wrapper.find('.picker');
        expect(picker.attributes('data-accept')).toBe('*');
        expect(picker.attributes('data-folder-addable')).toBe('true');
        expect(picker.attributes('data-folder-label')).toBe('Link');
    });

    it('links a picked file into the folder that is open', async () =>
    {
        const wrapper = mountModal();
        await useDriveStore().load('parent1');

        useNewItemStore().requestNew('link');
        await flushPromises();
        await pick(wrapper, 'select', fileNode('f1'));

        expect(createNodeMock).toHaveBeenCalledWith({ type: 'link', targetNodeID: 'f1', parentID: 'parent1' });
        expect(isOpen(wrapper)).toBe('false');
    });

    // Entering a folder and choosing it are different intents; the picker reaches the second through its own event.
    it('links a picked folder just as readily', async () =>
    {
        const wrapper = mountModal();
        await useDriveStore().load('parent1');

        useNewItemStore().requestNew('link');
        await flushPromises();
        await pick(wrapper, 'select-folder', folderNode('d1'));

        expect(createNodeMock).toHaveBeenCalledWith({ type: 'link', targetNodeID: 'd1', parentID: 'parent1' });
    });

    // The server names a link after its target, so nothing is sent: a name here would be the client guessing at one.
    it('sends no name, leaving the link to take its target\'s', async () =>
    {
        const wrapper = mountModal();
        useNewItemStore().requestNew('link');
        await flushPromises();
        await pick(wrapper, 'select', fileNode('f1'));

        expect(createNodeMock.mock.calls[0]?.[0]).not.toHaveProperty('name');
    });

    it('stays open and toasts when the create fails', async () =>
    {
        createNodeMock.mockRejectedValue(new Error('boom'));
        const wrapper = mountModal();

        useNewItemStore().requestNew('link');
        await flushPromises();
        await pick(wrapper, 'select', fileNode('f1'));

        expect(isOpen(wrapper)).toBe('true');
        expect(toastAdd).toHaveBeenCalled();
    });
});

//----------------------------------------------------------------------------------------------------------------------
