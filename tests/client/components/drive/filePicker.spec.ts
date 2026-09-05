//----------------------------------------------------------------------------------------------------------------------
// File Picker — mime gating and folder navigation
//
// Only the nodes RA is mocked; the real session store runs (for the root label). What this guards: folders are always
// navigable and drilling into one lists that folder's children, while files are selectable only when their mime type
// matches the accept list -- an exact mime, or a whole family via the accept attribute's own `type/*` form; a
// non-matching file is disabled and never emitted.
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
        sharing: null,
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
        sharing: null,
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

type PickerProps = InstanceType<typeof FilePicker>['$props'];

function mountPicker(accept : readonly string[] = acceptImages, extra : Partial<PickerProps> = {}) : VueWrapper
{
    return mount(FilePicker, {
        props: { accept, ...extra },
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

    it('accepts a whole mime family via a type/* entry, still refusing everything else', async () =>
    {
        getChildrenMock.mockResolvedValue(page([
            fileNode('f1', 'song.mp3', 'audio/mpeg'),
            fileNode('f2', 'clip.mp4', 'video/mp4'),
            fileNode('f3', 'notes.txt', 'text/plain'),
        ]));
        const wrapper = mountPicker([ 'audio/*', 'video/*' ]);
        await flushPromises();

        expect(entry(wrapper, 'song.mp3')?.attributes('disabled')).toBeUndefined();
        expect(entry(wrapper, 'clip.mp4')?.attributes('disabled')).toBeUndefined();
        expect(entry(wrapper, 'notes.txt')?.attributes('disabled')).toBeDefined();
    });

    it('marks already-picked rows with a check while leaving them pickable again', async () =>
    {
        getChildrenMock.mockResolvedValue(page([
            fileNode('f1', 'one.png', 'image/png'),
            fileNode('f2', 'two.png', 'image/png'),
        ]));
        const wrapper = mountPicker(acceptImages, { pickedIDs: new Set([ 'f1' ]) });
        await flushPromises();

        const picked = entry(wrapper, 'one.png');
        expect(picked?.find('[aria-label="In playlist"]').exists()).toBe(true);
        expect(picked?.attributes('disabled')).toBeUndefined();
        const unpicked = entry(wrapper, 'two.png')?.find('[aria-label="In playlist"]');
        expect(unpicked?.exists()).toBe(false);

        await picked?.trigger('click');
        expect(wrapper.emitted('select')).toHaveLength(1);
    });

    it('offers Add-all on folder rows only when the host asked for it, emitting the folder', async () =>
    {
        getChildrenMock.mockResolvedValue(page([ folderNode('d1', 'Music') ]));

        const plain = mountPicker();
        await flushPromises();
        expect(plain.find('button[data-label="Add all"]').exists()).toBe(false);

        const addable = mountPicker(acceptImages, { folderAddable: true });
        await flushPromises();

        await addable.get('button[data-label="Add all"]').trigger('click');

        const emitted = addable.emitted('select-folder')?.[0]?.[0] as NodeResponse;
        expect(emitted.id).toBe('d1');
        expect(addable.emitted('select')).toBeUndefined();
    });

    it('accepts by name suffix via a .ext entry, for types whose mimes are unreliable', async () =>
    {
        getChildrenMock.mockResolvedValue(page([
            fileNode('f1', 'mix.m3u8', 'application/octet-stream'),
            fileNode('f2', 'song.mp3', 'audio/mpeg'),
        ]));
        const wrapper = mountPicker([ '.m3u', '.m3u8' ]);
        await flushPromises();

        expect(entry(wrapper, 'mix.m3u8')?.attributes('disabled')).toBeUndefined();
        expect(entry(wrapper, 'song.mp3')?.attributes('disabled')).toBeDefined();
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
