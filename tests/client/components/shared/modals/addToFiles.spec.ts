//----------------------------------------------------------------------------------------------------------------------
// Add To Files Modal — imperative link placement into a chosen destination
//----------------------------------------------------------------------------------------------------------------------

import { type Mock, beforeEach, describe, expect, it, vi } from 'vitest';
import { type VueWrapper, flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';

import type { SharedTarget } from '@fileshed/core';

// Resource Access
import { createNode } from '@client/resource-access/nodes.ts';
import { sharedWithMe } from '@client/resource-access/shares.ts';

// Under test
import AddToFiles from '@client/components/shared/modals/addToFiles.vue';

//----------------------------------------------------------------------------------------------------------------------

const toastAdd = vi.hoisted(() => vi.fn());

vi.mock('@client/resource-access/nodes.ts', () => ({ createNode: vi.fn() }));
vi.mock('@client/resource-access/shares.ts', () => ({ sharedWithMe: vi.fn() }));
vi.mock('@nuxt/ui/composables', () => ({ useToast: () => ({ add: toastAdd }) }));

const createNodeMock = createNode as unknown as Mock;
const sharedWithMeMock = sharedWithMe as unknown as Mock;

//----------------------------------------------------------------------------------------------------------------------

interface Openable { open : (target : SharedTarget) => void }

function fileTarget(id : string, name : string) : SharedTarget
{
    return { id, type: 'file', name, ownerID: 'owner1' };
}

// UModal and FolderPicker are the presentational primitives the modal wraps; the stub renders the picker in the body
// slot and surfaces the modal's title and open flag, mirroring the Move modal's own test harness.
const UModalStub = {
    props: [ 'open', 'title' ],
    template: '<div class="umodal" :data-open="String(open)" :data-title="title"><slot name="body" /></div>',
};

const FolderPickerStub = {
    name: 'FolderPicker',
    props: [ 'movingNodeIDs', 'pending', 'verb' ],
    emits: [ 'confirm', 'cancel' ],
    template: '<div class="folder-picker" :data-count="movingNodeIDs.length" :data-verb="verb" />',
};

function mountModal() : VueWrapper
{
    setActivePinia(createPinia());

    return mount(AddToFiles, { global: { stubs: { UModal: UModalStub, FolderPicker: FolderPickerStub } } });
}

function open(wrapper : VueWrapper, target : SharedTarget) : Promise<void>
{
    (wrapper.vm as unknown as Openable).open(target);

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

describe('AddToFiles modal', () =>
{
    beforeEach(() =>
    {
        vi.clearAllMocks();
        sharedWithMeMock.mockResolvedValue({ entries: [] });
    });

    it('opens titled for the shared target and drives the picker with no moving set of its own', async () =>
    {
        const wrapper = mountModal();

        await open(wrapper, fileTarget('f1', 'report.txt'));

        expect(attr(wrapper, '.umodal', 'data-open')).toBe('true');
        expect(attr(wrapper, '.umodal', 'data-title')).toBe('Add "report.txt" to my files');
        expect(attr(wrapper, '.folder-picker', 'data-count')).toBe('0');

        // The picker speaks the placement verb, not the Move flow's -- "Add here", never "Move here".
        expect(attr(wrapper, '.folder-picker', 'data-verb')).toBe('Add');
    });

    it('places a link at the chosen destination, refreshes the listing, and closes', async () =>
    {
        createNodeMock.mockResolvedValue({ id: 'link1', type: 'link' });
        const wrapper = mountModal();
        await open(wrapper, fileTarget('f1', 'report.txt'));

        await confirm(wrapper, 'dest1');

        expect(createNodeMock).toHaveBeenCalledWith({ type: 'link', parentID: 'dest1', targetNodeID: 'f1' });
        expect(sharedWithMeMock).toHaveBeenCalledTimes(1);
        expect(attr(wrapper, '.umodal', 'data-open')).toBe('false');
    });

    it('places a link at the root when the caller confirms My Files itself', async () =>
    {
        createNodeMock.mockResolvedValue({ id: 'link1', type: 'link' });
        const wrapper = mountModal();
        await open(wrapper, fileTarget('f1', 'report.txt'));

        await confirm(wrapper, null);

        expect(createNodeMock).toHaveBeenCalledWith({ type: 'link', parentID: null, targetNodeID: 'f1' });
    });

    it('toasts success naming the target once placed', async () =>
    {
        createNodeMock.mockResolvedValue({ id: 'link1', type: 'link' });
        const wrapper = mountModal();
        await open(wrapper, fileTarget('f1', 'report.txt'));

        await confirm(wrapper, 'dest1');

        expect(toastAdd).toHaveBeenCalledWith(expect.objectContaining({
            title: 'Added to your files',
            description: '"report.txt" is now in your files.',
            color: 'success',
        }));
    });

    it('keeps the modal open and toasts an error when placement fails', async () =>
    {
        createNodeMock.mockRejectedValue(new Error('boom'));
        const wrapper = mountModal();
        await open(wrapper, fileTarget('f1', 'report.txt'));

        await confirm(wrapper, 'dest1');

        expect(toastAdd).toHaveBeenCalledWith(expect.objectContaining({ color: 'error' }));
        expect(attr(wrapper, '.umodal', 'data-open')).toBe('true');
    });
});

//----------------------------------------------------------------------------------------------------------------------
