//----------------------------------------------------------------------------------------------------------------------
// File Page
//
// The handler families are stood in for: each has its own specs, and what this page owns is choosing which one mounts
// for the routed file, or leaving the app for the browser's own renderer.
//----------------------------------------------------------------------------------------------------------------------

import { type Mock, beforeEach, describe, expect, it, vi } from 'vitest';
import { type VueWrapper, flushPromises, mount } from '@vue/test-utils';
import { createMemoryHistory, createRouter } from 'vue-router';
import { createPinia, setActivePinia } from 'pinia';

import type { NodeResponse } from '@fileshed/core';

// Resource Access
import { APIError } from '@client/resource-access/apiError.ts';
import { getNodeText } from '@client/resource-access/content.ts';
import { getNode } from '@client/resource-access/nodes.ts';

// Utils
import { replaceLocation } from '@client/utils/replaceLocation.ts';

// Stores
import { useEditorStore } from '@client/stores/editor.ts';

// Support
import { fileNode } from '../support.ts';

// Under test
import FilePage from '@client/pages/filePage.vue';

//----------------------------------------------------------------------------------------------------------------------

vi.mock('@client/resource-access/nodes.ts', () => ({ getNode: vi.fn(), patchNode: vi.fn() }));
vi.mock('@client/resource-access/content.ts', () => ({ getNodeText: vi.fn() }));
vi.mock('@client/utils/replaceLocation.ts', () => ({ replaceLocation: vi.fn() }));
vi.mock('@nuxt/ui/composables', () => ({ useToast: () => ({ add: vi.fn() }) }));

// A lazily imported family resolves through defineAsyncComponent, which takes the default export only from something
// marked as an ES module.
interface StandInModule { __esModule : true; default : object }

function standIn(name : string, props : string[] | Record<string, unknown> = []) : StandInModule
{
    return { __esModule: true, default: { name, props, template: `<div data-family="${ name }" />` } };
}

vi.mock('@client/components/handlers/markdown/markdownEditor.vue', () => standIn('MarkdownEditor', [ 'modelValue' ]));
vi.mock('@client/components/handlers/pdf/pdfAnnotator.vue', () => standIn('PDFAnnotator', [ 'nodeID' ]));
vi.mock('@client/components/handlers/media/mediaPlayer.vue', () => standIn('MediaPlayer', {
    node: Object,
    media: String,
    playlist: Boolean,
}));
vi.mock('@client/components/handlers/text/textEditor.vue', () => standIn('TextEditor', [ 'modelValue', 'readOnly' ]));
vi.mock('@client/components/handlers/text/toolbar.vue', () => standIn('EditorToolbar'));
vi.mock('@client/components/handlers/text/identityBar.vue', () => standIn('TextIdentityBar'));
vi.mock('@client/components/handlers/text/modals/conflictModal.vue', () => standIn('ConflictModal'));
vi.mock('@client/components/share/requestAccess.vue', () => standIn('RequestAccess', [ 'nodeID' ]));

const getNodeMock = getNode as unknown as Mock;
const getNodeTextMock = getNodeText as unknown as Mock;
const replaceLocationMock = replaceLocation as unknown as Mock;

const stubs = {
    UIcon: true,
    UButton: { props: [ 'label' ], template: '<button :data-label="label">{{ label }}</button>' },
};

async function openRoute(nodeID : string) : Promise<VueWrapper>
{
    const router = createRouter({
        history: createMemoryHistory(),
        routes: [
            { path: '/', component: { template: '<div />' } },
            { path: '/file/:id', component: FilePage },
        ],
    });
    await router.push(`/file/${ nodeID }`);
    await router.isReady();

    const wrapper = mount(FilePage, { global: { plugins: [ router ], stubs } });
    await flushPromises();

    return wrapper;
}

async function openFile(node : NodeResponse) : Promise<VueWrapper>
{
    getNodeMock.mockResolvedValue(node);

    return openRoute(node.id);
}

// The props a stood-in family was mounted with, or null when it did not mount.
function familyProps(wrapper : VueWrapper, name : string) : Record<string, unknown> | null
{
    const found = wrapper.findComponent({ name });

    return found.exists() ? found.props() as Record<string, unknown> : null;
}

beforeEach(() =>
{
    setActivePinia(createPinia());
    vi.clearAllMocks();
    getNodeTextMock.mockResolvedValue('hello');
});

//----------------------------------------------------------------------------------------------------------------------

describe('FilePage', () =>
{
    it('opens a text file in the editor with its content', async () =>
    {
        const wrapper = await openFile(fileNode({ id: 'n1', name: 'notes.txt', mimeType: 'text/plain' }));

        expect(familyProps(wrapper, 'TextEditor')?.modelValue).toBe('hello');
    });

    it('opens a markdown file in the markdown editor', async () =>
    {
        const wrapper = await openFile(fileNode({ id: 'n1', name: 'notes.md', mimeType: 'text/markdown' }));

        expect(familyProps(wrapper, 'MarkdownEditor')?.modelValue).toBe('hello');
        expect(familyProps(wrapper, 'TextEditor')).toBeNull();
    });

    it('opens a PDF in the annotator', async () =>
    {
        const wrapper = await openFile(fileNode({ id: 'n1', name: 'report.pdf', mimeType: 'application/pdf' }));

        expect(familyProps(wrapper, 'PDFAnnotator')?.nodeID).toBe('n1');
    });

    it('plays audio and video in the media player as what they are', async () =>
    {
        const audio = await openFile(fileNode({ id: 'n1', name: 'song.mp3', mimeType: 'audio/mpeg' }));
        const video = await openFile(fileNode({ id: 'n2', name: 'clip.mp4', mimeType: 'video/mp4' }));

        expect(familyProps(audio, 'MediaPlayer')?.media).toBe('audio');
        expect(familyProps(video, 'MediaPlayer')?.media).toBe('video');
    });

    it('plays a playlist as a playlist', async () =>
    {
        const wrapper = await openFile(fileNode({ id: 'n1', name: 'mix.m3u', mimeType: 'audio/x-mpegurl' }));

        expect(familyProps(wrapper, 'MediaPlayer')?.playlist).toBe(true);
    });

    it('hands a file the browser can show to the browser\'s own viewer', async () =>
    {
        await openFile(fileNode({ id: 'n1', name: 'photo.png', mimeType: 'image/png' }));

        expect(replaceLocationMock).toHaveBeenCalledWith('/api/nodes/n1/download?disposition=inline');
    });

    it('downloads a file the browser cannot show', async () =>
    {
        await openFile(fileNode({ id: 'n1', name: 'bundle.zip', mimeType: 'application/zip' }));

        expect(replaceLocationMock).toHaveBeenCalledWith('/api/nodes/n1/download');
    });

    // The server answers 404 for a file that is gone and for one the caller cannot see alike.
    it('offers to request access when the file does not resolve', async () =>
    {
        getNodeMock.mockRejectedValue(new APIError(404, 'Not found.'));

        const wrapper = await openRoute('n1');

        expect(familyProps(wrapper, 'RequestAccess')?.nodeID).toBe('n1');
    });

    it('says the server failed, rather than asking for access, when the read errors', async () =>
    {
        getNodeMock.mockRejectedValue(new APIError(500, 'Storage is unavailable.'));

        const wrapper = await openRoute('n1');

        expect(familyProps(wrapper, 'RequestAccess')).toBeNull();
        expect(wrapper.text()).toContain('Storage is unavailable.');
        expect(wrapper.find('[data-label="Go to my files"]').exists()).toBe(true);
    });
});

//----------------------------------------------------------------------------------------------------------------------

describe('FilePage save shortcut', () =>
{
    function pressSave() : void
    {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ctrlKey: true }));
    }

    it('saves an editable text file on Ctrl+S', async () =>
    {
        await openFile(fileNode({ id: 'n1', name: 'notes.txt', mimeType: 'text/plain' }));
        const save = vi.spyOn(useEditorStore(), 'save').mockResolvedValue();

        pressSave();

        expect(save).toHaveBeenCalledTimes(1);
    });

    it('saves nothing for a viewer', async () =>
    {
        await openFile(fileNode({ id: 'n1', name: 'notes.txt', mimeType: 'text/plain', role: 'viewer' }));
        const save = vi.spyOn(useEditorStore(), 'save').mockResolvedValue();

        pressSave();

        expect(save).not.toHaveBeenCalled();
    });

    it('lets go of the open file when the page goes', async () =>
    {
        const wrapper = await openFile(fileNode({ id: 'n1', name: 'notes.txt', mimeType: 'text/plain' }));

        wrapper.unmount();

        expect(useEditorStore().node).toBeNull();
    });
});

//----------------------------------------------------------------------------------------------------------------------
