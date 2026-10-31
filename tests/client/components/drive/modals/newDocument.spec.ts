//----------------------------------------------------------------------------------------------------------------------
// New Document Modal — self-subscribed empty-file creation
//----------------------------------------------------------------------------------------------------------------------

import { type Mock, beforeEach, describe, expect, it, vi } from 'vitest';
import { type VueWrapper, flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';

import type { NodeListResponse } from '@fileshed/core';

// Resource Access
import { getNode, listChildren } from '@client/resource-access/nodes.ts';

// Stores
import { commitFile } from '@client/stores/commitFile.ts';
import { useDriveStore } from '@client/stores/drive.ts';
import { useNewItemStore } from '@client/stores/newItem.ts';

// Support
import { fileNode, folderNode } from '../../../support.ts';

// Under test
import NewDocument from '@client/components/drive/modals/newDocument.vue';

//----------------------------------------------------------------------------------------------------------------------

const toastAdd = vi.hoisted(() => vi.fn());
const routerPush = vi.hoisted(() => vi.fn());

vi.mock('vue-router', () => ({ useRouter: () => ({ push: routerPush }) }));

vi.mock('@client/resource-access/nodes.ts', () => ({
    listChildren: vi.fn(),
    getNode: vi.fn(),
}));

vi.mock('@client/stores/commitFile.ts', () => ({ commitFile: vi.fn() }));

vi.mock('@nuxt/ui/composables', () => ({ useToast: () => ({ add: toastAdd }) }));

const listChildrenMock = listChildren as unknown as Mock;
const getNodeMock = getNode as unknown as Mock;
const commitMock = commitFile as unknown as Mock;

//----------------------------------------------------------------------------------------------------------------------

function emptyPage() : NodeListResponse
{
    return { nodes: [], total: 0, limit: 50, offset: 0, owners: [] };
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

async function submit(wrapper : VueWrapper, name : string) : Promise<void>
{
    wrapper.findComponent({ name: 'NameDialog' }).vm.$emit('submit', name);

    await flushPromises();
}

//----------------------------------------------------------------------------------------------------------------------

describe('NewDocument modal', () =>
{
    beforeEach(() =>
    {
        setActivePinia(createPinia());
        vi.clearAllMocks();
        listChildrenMock.mockResolvedValue(emptyPage());
        getNodeMock.mockResolvedValue(folderNode({ id: 'parent1' }));
        commitMock.mockResolvedValue(fileNode({ id: 'doc' }));
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

        const [ , placement ] = commitMock.mock.calls[0] ?? [];
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

        // The commit landed a node with id 'doc', so the modal drops the user into its editor route.
        expect(routerPush).toHaveBeenCalledWith('/file/doc');
    });

    it('keeps the modal open and toasts when creation fails', async () =>
    {
        commitMock.mockRejectedValue(new Error('boom'));
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
