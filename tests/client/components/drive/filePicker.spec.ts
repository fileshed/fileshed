//----------------------------------------------------------------------------------------------------------------------
// File Picker — mime gating and folder navigation
//
// Only the nodes RA is mocked; the real session store runs (for the root label). What this guards: folders are always
// navigable and drilling into one lists that folder's children, while files are selectable only when their mime type
// is in the accept list -- a non-matching file is disabled and never emitted.
//----------------------------------------------------------------------------------------------------------------------

import { type Mock, beforeEach, describe, expect, it, vi } from 'vitest';
import { type VueWrapper, flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';

import type { NodeListResponse, NodeResponse } from '@fileshed/core';

// Resource Access
import { getChildren } from '@client/resource-access/nodes.ts';

// Under test
import FilePicker from '@client/components/drive/filePicker.vue';

//----------------------------------------------------------------------------------------------------------------------

vi.mock('@client/resource-access/authClient.ts', () => ({ authClient: { updateUser: vi.fn() } }));
vi.mock('@client/resource-access/avatar.ts', () => ({ uploadAvatar: vi.fn(), deleteAvatar: vi.fn() }));
vi.mock('@client/resource-access/me.ts', () => ({ fetchMe: vi.fn() }));
vi.mock('@client/resource-access/nodes.ts', () => ({ getChildren: vi.fn() }));

const getChildrenMock = getChildren as unknown as Mock;

//----------------------------------------------------------------------------------------------------------------------

function folderNode(id : string, name : string) : NodeResponse
{
    return {
        id,
        name,
        ownerID: 'user_1',
        parentID: null,
        createdAt: '2026-07-20T00:00:00.000Z',
        updatedAt: '2026-07-20T00:00:00.000Z',
        role: 'owner',
        type: 'folder',
        trashedAt: null,
    };
}

function fileNode(id : string, name : string, mimeType : string) : NodeResponse
{
    return {
        id,
        name,
        ownerID: 'user_1',
        parentID: null,
        createdAt: '2026-07-20T00:00:00.000Z',
        updatedAt: '2026-07-20T00:00:00.000Z',
        role: 'owner',
        type: 'file',
        blobID: `blob_${ id }`,
        size: 10,
        mimeType,
        trashedAt: null,
    };
}

function page(nodes : NodeResponse[]) : NodeListResponse
{
    return { nodes, total: nodes.length, limit: 200, offset: 0, owners: [] };
}

const UButtonStub = {
    name: 'UButton',
    props: [ 'label', 'disabled' ],
    emits: [ 'click' ],
    template: '<button class="u-button" :data-label="label" @click="$emit(\'click\')">{{ label }}</button>',
};

const acceptImages = [ 'image/png', 'image/jpeg' ];

function mountPicker() : VueWrapper
{
    return mount(FilePicker, {
        props: { accept: acceptImages },
        global: { stubs: { UButton: UButtonStub, UIcon: true } },
    });
}

// The drive entries are raw <button> rows (the chrome buttons are the stubbed UButton with a data-label).
function entry(wrapper : VueWrapper, name : string) : ReturnType<VueWrapper['get']> | undefined
{
    return wrapper.findAll('button:not([data-label])').find((row) => row.text().includes(name));
}

//----------------------------------------------------------------------------------------------------------------------

describe('FilePicker', () =>
{
    beforeEach(() =>
    {
        setActivePinia(createPinia());
        vi.clearAllMocks();
    });

    it('disables a file whose mime type is not in the accept list', async () =>
    {
        getChildrenMock.mockResolvedValue(page([
            fileNode('f1', 'ok.png', 'image/png'),
            fileNode('f2', 'notes.txt', 'text/plain'),
        ]));
        const wrapper = mountPicker();
        await flushPromises();

        expect(entry(wrapper, 'ok.png')?.attributes('disabled')).toBeUndefined();
        expect(entry(wrapper, 'notes.txt')?.attributes('disabled')).toBeDefined();
    });

    it('emits the selected node when an accepted file is clicked', async () =>
    {
        getChildrenMock.mockResolvedValue(page([ fileNode('f1', 'ok.png', 'image/png') ]));
        const wrapper = mountPicker();
        await flushPromises();

        await entry(wrapper, 'ok.png')?.trigger('click');

        const selected = wrapper.emitted('select')?.[0]?.[0] as NodeResponse;
        expect(selected.id).toBe('f1');
    });

    it('does not emit when a disabled, non-matching file is clicked', async () =>
    {
        getChildrenMock.mockResolvedValue(page([ fileNode('f2', 'notes.txt', 'text/plain') ]));
        const wrapper = mountPicker();
        await flushPromises();

        await entry(wrapper, 'notes.txt')?.trigger('click');

        expect(wrapper.emitted('select')).toBeUndefined();
    });

    it('drills into a folder and lists its children', async () =>
    {
        getChildrenMock.mockImplementation((parentID : string | null) =>
        {
            if(parentID === null) { return Promise.resolve(page([ folderNode('d1', 'Photos') ])); }
            if(parentID === 'd1') { return Promise.resolve(page([ fileNode('f3', 'inner.png', 'image/png') ])); }

            return Promise.resolve(page([]));
        });
        const wrapper = mountPicker();
        await flushPromises();

        await entry(wrapper, 'Photos')?.trigger('click');
        await flushPromises();

        expect(getChildrenMock).toHaveBeenCalledWith('d1', expect.anything());
        expect(entry(wrapper, 'inner.png')).toBeDefined();
        expect(wrapper.emitted('select')).toBeUndefined();
    });
});

//----------------------------------------------------------------------------------------------------------------------
