//----------------------------------------------------------------------------------------------------------------------
// Avatar Edit Modal — source state machine and crop-before-upload
//
// Only the avatar and content RAs are mocked; the real session store runs, so a save or a remove proves the whole
// path. The Cropper is stubbed (jsdom has no real canvas) with a controllable toBlob, and the FilePicker is stubbed to
// emit a chosen node without a network browse. URL.createObjectURL/revokeObjectURL are stubbed so the object-URL
// lifecycle is directly observable. The modal opens with no argument onto a source step: browse FileShed, upload from
// device, or remove the current photo; both file paths land on the crop step.
//----------------------------------------------------------------------------------------------------------------------

import { type Mock, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type DOMWrapper, type VueWrapper, flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';

import type { NodeResponse } from '@fileshed/core';

// Resource Access
import { uploadAvatar } from '@client/resource-access/avatar.ts';
import { fetchNodeBlob } from '@client/resource-access/content.ts';

// Stores
import { useAppStore } from '@client/stores/app.ts';
import { useSessionStore } from '@client/stores/session.ts';

// Support
import { meFixture } from '../../../support.ts';

// Under test
import AvatarEditModal from '@client/components/account/modals/avatarEditModal.vue';

//----------------------------------------------------------------------------------------------------------------------

// The session store also reaches for auth/me at module scope -- stub them so importing it never hits the network.
vi.mock('@client/resource-access/authClient.ts', () => ({ authClient: { updateUser: vi.fn() } }));
vi.mock('@client/resource-access/avatar.ts', () => ({ uploadAvatar: vi.fn(), deleteAvatar: vi.fn() }));
vi.mock('@client/resource-access/me.ts', () => ({ fetchMe: vi.fn() }));
vi.mock('@client/resource-access/content.ts', () => ({ fetchNodeBlob: vi.fn() }));

const toastAdd = vi.fn();
vi.mock('@nuxt/ui/composables', () => ({ useToast: () => ({ add: toastAdd }) }));

const uploadAvatarMock = uploadAvatar as unknown as Mock;
const fetchNodeBlobMock = fetchNodeBlob as unknown as Mock;

//----------------------------------------------------------------------------------------------------------------------

function fileNode(overrides : Partial<NodeResponse> = {}) : NodeResponse
{
    return {
        id: 'node_1',
        name: 'headshot.jpg',
        ownerID: 'user_1',
        parentID: null,
        createdAt: '2026-07-20T00:00:00.000Z',
        updatedAt: '2026-07-20T00:00:00.000Z',
        role: 'owner',
        type: 'file',
        blobID: 'blob_1',
        size: 1024,
        mimeType: 'image/jpeg',
        trashedAt: null,
        ...overrides,
    } as NodeResponse;
}

interface FakeCanvas { toBlob : Mock }

let resultCanvas : FakeCanvas;

const CropperStub = {
    name: 'Cropper',
    props: [ 'src', 'stencilComponent', 'stencilProps', 'canvas' ],
    template: '<div class="cropper" :data-src="src" />',
    methods: {
        getResult()
        {
            return { canvas: resultCanvas };
        },
    },
};

const UModalStub = {
    name: 'UModal',
    props: [ 'open', 'title', 'description', 'dismissible' ],
    emits: [ 'update:open' ],
    template: '<div v-if="open" class="u-modal" :data-title="title" :data-description="description">'
        + '<slot name="body" /></div>',
};

const UButtonStub = {
    name: 'UButton',
    props: [ 'label', 'loading', 'disabled' ],
    emits: [ 'click' ],
    template: '<button :data-label="label" :disabled="disabled || null" @click="$emit(\'click\')">{{ label }}</button>',
};

const FilePickerStub = {
    name: 'FilePicker',
    props: [ 'accept', 'pending' ],
    emits: [ 'select', 'cancel' ],
    template: '<div class="file-picker" />',
};

function mountModal() : VueWrapper
{
    return mount(AvatarEditModal, {
        global: {
            stubs: { UModal: UModalStub, UButton: UButtonStub, Cropper: CropperStub, FilePicker: FilePickerStub },
        },
    });
}

interface Openable { open : () => void }

async function openModal(wrapper : VueWrapper) : Promise<void>
{
    (wrapper.vm as unknown as Openable).open();
    await flushPromises();
}

// A button is found by its visible label, whether it renders through the UButton stub (data-label) or as a plain
// element (text content) -- the contract is the label the user sees, not the component behind it.
function findButton(wrapper : VueWrapper, label : string) : DOMWrapper<Element> | undefined
{
    const stubbed = wrapper.find(`button[data-label="${ label }"]`);
    if(stubbed.exists()) { return stubbed; }

    return wrapper.findAll('button').find((candidate) => candidate.text().trim() === label);
}

function button(wrapper : VueWrapper, label : string) : DOMWrapper<Element>
{
    const found = findButton(wrapper, label);
    if(!found) { throw new Error(`No button labeled "${ label }"`); }

    return found;
}

function hasButton(wrapper : VueWrapper, label : string) : boolean
{
    return findButton(wrapper, label) !== undefined;
}

// Drive the hidden file input the way a real pick does: attach a FileList, then fire change.
async function pickDeviceFile(wrapper : VueWrapper, file : File) : Promise<void>
{
    const input = wrapper.find('input[type="file"]');
    Object.defineProperty(input.element, 'files', { value: [ file ], configurable: true });
    await input.trigger('change');
    await flushPromises();
}

//----------------------------------------------------------------------------------------------------------------------

describe('AvatarEditModal', () =>
{
    let createObjectURLMock : Mock;
    let revokeObjectURLMock : Mock;

    beforeEach(() =>
    {
        setActivePinia(createPinia());
        vi.clearAllMocks();

        resultCanvas = {
            toBlob: vi.fn((callback : (blob : Blob | null) => void) =>
            {
                callback(new Blob([ 'png-bytes' ], { type: 'image/png' }));
            }),
        };

        createObjectURLMock = vi.fn(() => 'blob:mock-url');
        revokeObjectURLMock = vi.fn();
        vi.stubGlobal('URL', Object.assign(URL, {
            createObjectURL: createObjectURLMock,
            revokeObjectURL: revokeObjectURLMock,
        }));
    });

    afterEach(() => vi.unstubAllGlobals());

    //------------------------------------------------------------------------------------------------------------------
    // Source step
    //------------------------------------------------------------------------------------------------------------------

    it('offers Remove photo on the source step only when an avatar is set', async () =>
    {
        const session = useSessionStore();
        session.me = meFixture({ image: '/api/avatars/abc' });
        const wrapper = mountModal();

        await openModal(wrapper);

        expect(hasButton(wrapper, 'Remove photo')).toBe(true);
    });

    it('hides Remove photo on the source step when no avatar is set', async () =>
    {
        const session = useSessionStore();
        session.me = meFixture({ image: null });
        const wrapper = mountModal();

        await openModal(wrapper);

        expect(hasButton(wrapper, 'Remove photo')).toBe(false);
    });

    it('removes the current photo and closes when Remove is chosen', async () =>
    {
        const session = useSessionStore();
        session.me = meFixture({ image: '/api/avatars/abc' });
        const { deleteAvatar } = await import('@client/resource-access/avatar.ts');
        const { fetchMe } = await import('@client/resource-access/me.ts');
        (deleteAvatar as unknown as Mock).mockResolvedValue(undefined);
        (fetchMe as unknown as Mock).mockResolvedValue(meFixture({ image: null }));
        const wrapper = mountModal();
        await openModal(wrapper);

        await button(wrapper, 'Remove photo').trigger('click');
        await flushPromises();

        expect(session.me?.image).toBeNull();
        expect(wrapper.find('.u-modal').exists()).toBe(false);
    });

    //------------------------------------------------------------------------------------------------------------------
    // Device path
    //------------------------------------------------------------------------------------------------------------------

    it('rejects an unsupported device file before it ever reaches the crop step', async () =>
    {
        const session = useSessionStore();
        session.me = meFixture();
        const wrapper = mountModal();
        await openModal(wrapper);

        await pickDeviceFile(wrapper, new File([ '%PDF' ], 'doc.pdf', { type: 'application/pdf' }));

        expect(wrapper.find('.cropper').exists()).toBe(false);
        expect(toastAdd).toHaveBeenCalledWith(expect.objectContaining({ color: 'error' }));
    });

    it('advances a supported device image to the crop step', async () =>
    {
        const session = useSessionStore();
        session.me = meFixture();
        const wrapper = mountModal();
        await openModal(wrapper);

        await pickDeviceFile(wrapper, new File([ 'bytes' ], 'me.png', { type: 'image/png' }));

        expect(wrapper.find('.cropper').exists()).toBe(true);
        expect(wrapper.find('.cropper').attributes('data-src')).toBe('blob:mock-url');
    });

    it('exports a device crop as a PNG named after the source file, uploads it, and closes', async () =>
    {
        const session = useSessionStore();
        session.me = meFixture({ image: null });
        uploadAvatarMock.mockResolvedValue(meFixture({ image: '/api/avatars/new' }));
        const wrapper = mountModal();
        await openModal(wrapper);
        await pickDeviceFile(wrapper, new File([ 'bytes' ], 'vacation.jpg', { type: 'image/jpeg' }));

        await button(wrapper, 'Save').trigger('click');
        await flushPromises();

        expect(resultCanvas.toBlob).toHaveBeenCalledWith(expect.any(Function), 'image/png');
        const [ uploaded ] = uploadAvatarMock.mock.calls[0] as [ File ];
        expect(uploaded.name).toBe('vacation.png');
        expect(uploaded.type).toBe('image/png');
        expect(session.me?.image).toBe('/api/avatars/new');
        expect(wrapper.find('.u-modal').exists()).toBe(false);
    });

    //------------------------------------------------------------------------------------------------------------------
    // FileShed path
    //------------------------------------------------------------------------------------------------------------------

    it('fetches the chosen FileShed file bytes and feeds them to the crop step', async () =>
    {
        const session = useSessionStore();
        session.me = meFixture();
        fetchNodeBlobMock.mockResolvedValue(new Blob([ 'jpeg-bytes' ], { type: 'image/jpeg' }));
        const wrapper = mountModal();
        await openModal(wrapper);

        await button(wrapper, 'Choose from FileShed').trigger('click');
        wrapper.findComponent(FilePickerStub).vm.$emit('select', fileNode({ id: 'node_9', name: 'avatar.jpg' }));
        await flushPromises();

        expect(fetchNodeBlobMock).toHaveBeenCalledWith('node_9');
        expect(wrapper.find('.cropper').exists()).toBe(true);
        expect(wrapper.find('.cropper').attributes('data-src')).toBe('blob:mock-url');
    });

    it('saves a crop from a FileShed pick as a PNG named after the file and closes', async () =>
    {
        const session = useSessionStore();
        session.me = meFixture({ image: null });
        fetchNodeBlobMock.mockResolvedValue(new Blob([ 'jpeg-bytes' ], { type: 'image/jpeg' }));
        uploadAvatarMock.mockResolvedValue(meFixture({ image: '/api/avatars/fs' }));
        const wrapper = mountModal();
        await openModal(wrapper);
        await button(wrapper, 'Choose from FileShed').trigger('click');
        wrapper.findComponent(FilePickerStub).vm.$emit('select', fileNode({ id: 'node_9', name: 'avatar.jpg' }));
        await flushPromises();

        await button(wrapper, 'Save').trigger('click');
        await flushPromises();

        const [ uploaded ] = uploadAvatarMock.mock.calls[0] as [ File ];
        expect(uploaded.name).toBe('avatar.png');
        expect(uploaded.type).toBe('image/png');
        expect(session.me?.image).toBe('/api/avatars/fs');
        expect(wrapper.find('.u-modal').exists()).toBe(false);
    });

    //------------------------------------------------------------------------------------------------------------------
    // Crop step controls
    //------------------------------------------------------------------------------------------------------------------

    it('revokes the object URL and returns to the source step on Back', async () =>
    {
        const session = useSessionStore();
        session.me = meFixture();
        const wrapper = mountModal();
        await openModal(wrapper);
        await pickDeviceFile(wrapper, new File([ 'bytes' ], 'me.png', { type: 'image/png' }));

        await button(wrapper, 'Back').trigger('click');

        expect(revokeObjectURLMock).toHaveBeenCalledWith('blob:mock-url');
        expect(wrapper.find('.cropper').exists()).toBe(false);
        expect(hasButton(wrapper, 'Choose from FileShed')).toBe(true);
    });

    it('keeps the modal open and toasts when the upload fails', async () =>
    {
        const session = useSessionStore();
        session.me = meFixture();
        uploadAvatarMock.mockRejectedValue(new Error('boom'));
        const wrapper = mountModal();
        await openModal(wrapper);
        await pickDeviceFile(wrapper, new File([ 'bytes' ], 'me.png', { type: 'image/png' }));

        await button(wrapper, 'Save').trigger('click');
        await flushPromises();

        expect(toastAdd).toHaveBeenCalledWith(expect.objectContaining({ color: 'error' }));
        expect(wrapper.find('.u-modal').exists()).toBe(true);
    });

    //------------------------------------------------------------------------------------------------------------------
    // The size cap named on the source step is the operator's, not the one this bundle was built against.
    //------------------------------------------------------------------------------------------------------------------

    it('names the instance\'s configured avatar cap', async () =>
    {
        useSessionStore().me = meFixture();
        useAppStore().limits = { uploadMaxBytes: 5_000_000_000, avatarMaxBytes: 5_000_000 };

        const wrapper = mountModal();
        await openModal(wrapper);

        expect(wrapper.find('.u-modal').attributes('data-description')).toContain('5 MB');
    });

    it('follows the cap when the instance raises it', async () =>
    {
        useSessionStore().me = meFixture();
        const app = useAppStore();
        app.limits = { uploadMaxBytes: 5_000_000_000, avatarMaxBytes: 5_000_000 };

        const wrapper = mountModal();
        await openModal(wrapper);

        app.limits = { uploadMaxBytes: 5_000_000_000, avatarMaxBytes: 8_000_000 };
        await flushPromises();

        expect(wrapper.find('.u-modal').attributes('data-description')).toContain('8 MB');
    });
});

//----------------------------------------------------------------------------------------------------------------------
