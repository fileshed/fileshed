//----------------------------------------------------------------------------------------------------------------------
// New Document Modal — self-subscribed empty-file creation
//----------------------------------------------------------------------------------------------------------------------

import { type Mock, beforeEach, describe, expect, it, vi } from 'vitest';
import { type VueWrapper, flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';

import type { NodeListResponse, NodeResponse } from '@fileshed/core';

// Resource Access
import { getChildren, getNode } from '@client/resource-access/nodes.ts';
import { claimBlob, uploadTicket } from '@client/resource-access/blobs.ts';

// Stores
import { useDriveStore } from '@client/stores/drive.ts';
import { useNewItemStore } from '@client/stores/newItem.ts';

// Under test
import NewDocument from '@client/components/drive/modals/newDocument.vue';

//----------------------------------------------------------------------------------------------------------------------

const toastAdd = vi.hoisted(() => vi.fn());
const routerPush = vi.hoisted(() => vi.fn());

vi.mock('vue-router', () => ({ useRouter: () => ({ push: routerPush }) }));

vi.mock('@client/resource-access/nodes.ts', () => ({
    getChildren: vi.fn(),
    getNode: vi.fn(),
}));

vi.mock('@client/resource-access/blobs.ts', () => ({
    claimBlob: vi.fn(),
    uploadTicket: vi.fn(),
    answerChallenge: vi.fn(),
}));

vi.mock('@nuxt/ui/composables', () => ({ useToast: () => ({ add: toastAdd }) }));

const getChildrenMock = getChildren as unknown as Mock;
const getNodeMock = getNode as unknown as Mock;
const claimBlobMock = claimBlob as unknown as Mock;
const uploadTicketMock = uploadTicket as unknown as Mock;

//----------------------------------------------------------------------------------------------------------------------

const ISO = '2026-07-01T00:00:00.000Z';

function emptyPage() : NodeListResponse
{
    return { nodes: [], total: 0, limit: 50, offset: 0, owners: [] };
}

function fileNode(id : string) : NodeResponse
{
    return {
        id,
        name: id,
        ownerID: 'u1',
        parentID: null,
        createdAt: ISO,
        updatedAt: ISO,
        role: 'owner',
        type: 'file',
        blobID: 'b1',
        size: 0,
        mimeType: 'text/plain',
        trashedAt: null,
    };
}

function folderNode(id : string) : NodeResponse
{
    return {
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

// NameDialog is the presentational primitive the modal wraps; this stub surfaces its title, prefill, and open flag, and
// emits the entered name.
const NameDialogStub = {
    name: 'NameDialog',
    props: [ 'open', 'title', 'initial', 'pending' ],
    emits: [ 'submit', 'update:open' ],
    template: '<div class="name-dialog" :data-open="String(open)" :data-title="title" :data-initial="initial" />',
};

function mountModal() : VueWrapper
{
    return mount(NewDocument, { global: { stubs: { NameDialog: NameDialogStub } } });
}

function field(wrapper : VueWrapper, name : string) : string | undefined
{
    return wrapper.find('.name-dialog').attributes(name);
}

function submit(wrapper : VueWrapper, name : string) : Promise<void>
{
    wrapper.findComponent({ name: 'NameDialog' }).vm.$emit('submit', name);

    return flushPromises();
}

//----------------------------------------------------------------------------------------------------------------------

describe('NewDocument modal', () =>
{
    beforeEach(() =>
    {
        setActivePinia(createPinia());
        vi.clearAllMocks();
        getChildrenMock.mockResolvedValue(emptyPage());
        getNodeMock.mockResolvedValue(folderNode('parent1'));
        claimBlobMock.mockResolvedValue({ upload: true, ticket: 'TICKET' });
        uploadTicketMock.mockResolvedValue(fileNode('doc'));
    });

    it('opens the Markdown prompt, prefilled Untitled.md, on a markdown request', async () =>
    {
        const wrapper = mountModal();

        useNewItemStore().requestNew('markdown');
        await flushPromises();

        expect(field(wrapper, 'data-open')).toBe('true');
        expect(field(wrapper, 'data-title')).toBe('New Markdown file');
        expect(field(wrapper, 'data-initial')).toBe('Untitled.md');
    });

    it('opens the text prompt, prefilled Untitled.txt, on a text request', async () =>
    {
        const wrapper = mountModal();

        useNewItemStore().requestNew('text');
        await flushPromises();

        expect(field(wrapper, 'data-open')).toBe('true');
        expect(field(wrapper, 'data-title')).toBe('New text file');
        expect(field(wrapper, 'data-initial')).toBe('Untitled.txt');
    });

    it('enforces the extension and creates the empty file in the open folder, then closes', async () =>
    {
        const wrapper = mountModal();
        await useDriveStore().load('parent1');

        useNewItemStore().requestNew('markdown');
        await flushPromises();
        await submit(wrapper, 'notes');

        const [ , , placement ] = uploadTicketMock.mock.calls[0] ?? [];
        expect(placement).toEqual({ name: 'notes.md', parentID: 'parent1', mimeType: 'text/markdown' });
        expect(field(wrapper, 'data-open')).toBe('false');
    });

    it('navigates straight into the editor for the created file', async () =>
    {
        const wrapper = mountModal();
        await useDriveStore().load('parent1');

        useNewItemStore().requestNew('markdown');
        await flushPromises();
        await submit(wrapper, 'notes');

        // The upload committed a node with id 'doc', so the modal drops the user into its editor route.
        expect(routerPush).toHaveBeenCalledWith('/file/doc');
    });

    it('keeps the modal open and toasts when creation fails', async () =>
    {
        claimBlobMock.mockRejectedValue(new Error('boom'));
        const wrapper = mountModal();

        useNewItemStore().requestNew('markdown');
        await flushPromises();
        await submit(wrapper, 'notes');

        expect(toastAdd).toHaveBeenCalledWith(expect.objectContaining({ color: 'error' }));
        expect(field(wrapper, 'data-open')).toBe('true');
        // A failed create never navigates.
        expect(routerPush).not.toHaveBeenCalled();
    });
});

//----------------------------------------------------------------------------------------------------------------------
