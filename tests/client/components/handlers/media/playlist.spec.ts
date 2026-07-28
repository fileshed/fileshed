//----------------------------------------------------------------------------------------------------------------------
// Playlist Panel — the queue's own UI
//
// The contract: one row per queued track in play order with the current row marked; clicking a row jumps playback
// there; each row's remove drops it without stopping what's playing; Add opens the drive picker modal, every pick
// appends while the picker stays open, and Done closes it. Exercised over the real store — the observable outcome
// of every interaction is the queue state, not a mock call.
//----------------------------------------------------------------------------------------------------------------------

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { type VueWrapper, flushPromises, mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import { createPinia, setActivePinia } from 'pinia';

import type { NodeResponse } from '@fileshed/core';

// Stores
import { useMediaPlayerStore } from '@client/stores/mediaPlayer.ts';

// Engines
import { brokenTrack, queueFromTrack } from '@client/engines/media/queue.ts';

// Under test
import MediaPlaylist from '@client/components/handlers/media/playlist.vue';

//----------------------------------------------------------------------------------------------------------------------

const { readMediaTagsMock, getChildrenMock } = vi.hoisted(() => ({
    readMediaTagsMock: vi.fn(),
    getChildrenMock: vi.fn(),
}));

vi.mock('@client/resource-access/mediaTags.ts', () => ({
    readMediaTags: readMediaTagsMock,
    releaseMediaTags: vi.fn(),
}));

vi.mock('@client/resource-access/nodes.ts', () => ({ getChildren: getChildrenMock, getNode: vi.fn() }));
vi.mock('@client/resource-access/blobs.ts', () => ({
    claimBlob: vi.fn(), uploadTicket: vi.fn(), answerChallenge: vi.fn(),
}));
vi.mock('@client/resource-access/content.ts', () => ({ fetchNodeBlob: vi.fn() }));
vi.mock('@nuxt/ui/composables', () => ({ useToast: () => ({ add: vi.fn() }) }));

//----------------------------------------------------------------------------------------------------------------------

const ISO = '2026-07-01T00:00:00.000Z';

function fileNode(overrides : Partial<{ id : string; name : string; mimeType : string }> = {}) : NodeResponse
{
    return {
        id: overrides.id ?? 'f1',
        name: overrides.name ?? 'song.mp3',
        ownerID: 'u1',
        parentID: null,
        createdAt: ISO,
        updatedAt: ISO,
        role: 'owner',
        type: 'file',
        blobID: 'b1',
        size: 10,
        mimeType: overrides.mimeType ?? 'audio/mpeg',
        trashedAt: null,
    };
}

function folderNode(overrides : Partial<{ id : string; name : string }> = {}) : NodeResponse
{
    return {
        id: overrides.id ?? 'd1',
        name: overrides.name ?? 'Music',
        ownerID: 'u1',
        parentID: null,
        createdAt: ISO,
        updatedAt: ISO,
        role: 'owner',
        type: 'folder',
        trashedAt: null,
    };
}

const UButtonStub = {
    name: 'UButton',
    props: [ 'icon', 'label', 'variant', 'color', 'size', 'ariaLabel', 'disabled', 'loading' ],
    emits: [ 'click' ],
    template: '<button :data-icon="icon" :aria-label="ariaLabel" :disabled="disabled || loading" '
        + '@click="$emit(\'click\')">{{ label }}</button>',
};

const UModalStub = {
    props: [ 'open', 'title' ],
    template: '<div class="umodal" :data-open="String(open)" :data-title="title"><slot name="body" /></div>',
};

const FilePickerStub = {
    name: 'FilePicker',
    props: [ 'accept', 'caption', 'cancelLabel', 'pending', 'pickedIDs', 'folderAddable' ],
    emits: [ 'select', 'select-folder', 'cancel' ],
    template: '<div class="file-picker" :data-accept="accept.join()" :data-caption="caption" />',
};

const stubs = {
    UButton: UButtonStub,
    UModal: UModalStub,
    UIcon: { props: [ 'name' ], template: '<i :data-icon="name" />' },
    UFormField: { template: '<div><slot /></div>' },
    UInput: {
        props: [ 'modelValue' ],
        emits: [ 'update:modelValue' ],
        template: '<input :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)">',
    },
    FilePicker: FilePickerStub,
};

function mountPanel() : VueWrapper
{
    return mount(MediaPlaylist, { global: { stubs } });
}

function rows(wrapper : VueWrapper) : ReturnType<VueWrapper['findAll']>
{
    return wrapper.findAll('.group');
}

function addButton(wrapper : VueWrapper) : ReturnType<VueWrapper['get']>
{
    return wrapper.get('button[aria-label="Add media"]');
}

beforeEach(() =>
{
    setActivePinia(createPinia());
    vi.clearAllMocks();
    readMediaTagsMock.mockResolvedValue(null);
});

//----------------------------------------------------------------------------------------------------------------------

describe('MediaPlaylist rows', () =>
{
    it('renders one row per track in play order, marking the current one', async () =>
    {
        const store = useMediaPlayerStore();
        store.open(fileNode({ id: 'a1', name: 'one.mp3' }), 'audio');
        store.add(fileNode({ id: 'a2', name: 'two.mp3' }));

        const wrapper = mountPanel();
        await nextTick();

        const entries = rows(wrapper);
        expect(entries).toHaveLength(2);
        expect(entries[0]?.text()).toContain('one.mp3');
        expect(entries[1]?.text()).toContain('two.mp3');
        expect(entries[0]?.find('[aria-current="true"]').exists()).toBe(true);
        expect(entries[1]?.find('[aria-current="true"]').exists()).toBe(false);
    });

    it('shows the empty invitation when nothing is queued', () =>
    {
        const wrapper = mountPanel();

        expect(wrapper.text()).toContain('Nothing queued.');
    });

    it('wears a track\'s embedded title and artist once read, leaving untagged rows on their filename', async () =>
    {
        readMediaTagsMock.mockImplementation((nodeID : string) =>
        {
            return Promise.resolve(nodeID === 'a1'
                ? { title: 'Neon Skyline', artist: 'The Sample Band', album: null, artworkUrl: null }
                : null);
        });

        const store = useMediaPlayerStore();
        store.open(fileNode({ id: 'a1', name: 'one.mp3' }), 'audio');
        store.add(fileNode({ id: 'a2', name: 'two.mp3' }));

        const wrapper = mountPanel();
        await flushPromises();

        const entries = rows(wrapper);
        expect(entries[0]?.text()).toContain('Neon Skyline');
        expect(entries[0]?.text()).toContain('The Sample Band');
        expect(entries[0]?.text()).not.toContain('one.mp3');
        expect(entries[1]?.text()).toContain('two.mp3');
    });

    it('jumps playback to a clicked row', async () =>
    {
        const store = useMediaPlayerStore();
        store.open(fileNode({ id: 'a1' }), 'audio');
        store.add(fileNode({ id: 'a2' }));

        const wrapper = mountPanel();
        await rows(wrapper)[1]?.get('button.flex-1').trigger('click');

        expect(store.track?.nodeID).toBe('a2');
        expect(store.autoplay).toBe(true);
    });

    it('wears the failed mark with a retry hint, and a click retries the track', async () =>
    {
        const store = useMediaPlayerStore();
        store.open(fileNode({ id: 'a1', name: 'one.mp3' }), 'audio');
        store.add(fileNode({ id: 'a2', name: 'two.mp3' }));
        store.handleTrackError();

        const wrapper = mountPanel();
        await nextTick();

        const failedRow = rows(wrapper)[0];
        expect(failedRow?.text()).toContain('Couldn\'t play — click to retry');
        expect(failedRow?.find('button[disabled]').exists()).toBe(false);

        await failedRow?.get('button[type="button"]').trigger('click');

        expect(store.currentIndex).toBe(0);
        expect(store.tracks[0]?.failed).toBe(false);
    });

    it('drags a row to a new position without touching what is playing', async () =>
    {
        const store = useMediaPlayerStore();
        store.open(fileNode({ id: 'a1', name: 'one.mp3' }), 'audio');
        store.add(fileNode({ id: 'a2', name: 'two.mp3' }));
        store.add(fileNode({ id: 'a3', name: 'three.mp3' }));
        const mountsBefore = store.playToken;

        const wrapper = mountPanel();
        await nextTick();

        await rows(wrapper)[2]?.trigger('dragstart');
        await rows(wrapper)[0]?.trigger('drop');

        expect(store.tracks.map((entry) => entry.name)).toEqual([ 'three.mp3', 'one.mp3', 'two.mp3' ]);
        expect(store.track?.name).toBe('one.mp3');
        expect(store.playToken).toBe(mountsBefore);
    });

    it('removes a row without stopping the current track', async () =>
    {
        const store = useMediaPlayerStore();
        store.open(fileNode({ id: 'a1' }), 'audio');
        store.add(fileNode({ id: 'a2', name: 'two.mp3' }));

        const wrapper = mountPanel();
        await rows(wrapper)[1]?.get('button[aria-label="Remove two.mp3 from playlist"]').trigger('click');

        expect(store.tracks.map((entry) => entry.nodeID)).toEqual([ 'a1' ]);
        expect(store.track?.nodeID).toBe('a1');
    });
});

//----------------------------------------------------------------------------------------------------------------------

describe('MediaPlaylist playlist file actions', () =>
{
    it('renders a broken entry dimmed and unclickable, wearing the question icon', async () =>
    {
        const store = useMediaPlayerStore();
        store.queue = queueFromTrack(brokenTrack('Ghost', '0'));

        const wrapper = mountPanel();
        await nextTick();

        const row = rows(wrapper)[0];
        expect(row?.get('button.flex-1').attributes('disabled')).toBeDefined();
        expect(row?.find('[data-icon="i-lucide-file-question"]').exists()).toBe(true);
    });

    it('offers Save only once a playlist file is adopted, and titles the panel with its name', async () =>
    {
        const store = useMediaPlayerStore();
        store.open(fileNode({ id: 'a1' }), 'audio');

        const wrapper = mountPanel();
        expect(wrapper.get('button[aria-label="Save playlist"]').attributes('disabled')).toBeDefined();

        store.playlistNode = fileNode({ id: 'pl', name: 'road-trip.m3u8' });
        await nextTick();

        expect(wrapper.get('button[aria-label="Save playlist"]').attributes('disabled')).toBeUndefined();
        expect(wrapper.text()).toContain('road-trip.m3u8');
    });

    it('Save As sends the typed name and optional title to the store', async () =>
    {
        const store = useMediaPlayerStore();
        store.open(fileNode({ id: 'a1' }), 'audio');
        const saveAs = vi.spyOn(store, 'savePlaylistAs').mockResolvedValue(undefined);

        const wrapper = mountPanel();
        await wrapper.get('button[aria-label="Save playlist as"]').trigger('click');
        await nextTick();

        const inputs = wrapper.findAll('form input');
        await inputs[0]?.setValue('road-trip');
        await inputs[1]?.setValue('Road Trip 2026');
        await wrapper.get('form').trigger('submit');
        await flushPromises();

        expect(saveAs).toHaveBeenCalledWith('road-trip', 'Road Trip 2026');
    });

    it('titles the panel with the playlist\'s display title over its file name', async () =>
    {
        const store = useMediaPlayerStore();
        store.open(fileNode({ id: 'a1' }), 'audio');
        store.playlistNode = fileNode({ id: 'pl', name: 'road-trip.m3u8' });
        store.playlistTitle = 'Road Trip 2026';

        const wrapper = mountPanel();
        await nextTick();

        expect(wrapper.text()).toContain('Road Trip 2026');
        expect(wrapper.text()).not.toContain('road-trip.m3u8');
    });

    it('edits the title inline, Docs-style, committing through the store', async () =>
    {
        const store = useMediaPlayerStore();
        store.open(fileNode({ id: 'a1' }), 'audio');
        store.playlistNode = fileNode({ id: 'pl', name: 'road-trip.m3u8' });
        store.playlistTitle = 'Road Trip 2026';
        const retitle = vi.spyOn(store, 'retitlePlaylist').mockResolvedValue(undefined);

        const wrapper = mountPanel();
        await nextTick();

        await wrapper.get('button[title="Edit title"]').trigger('click');
        await nextTick();

        const field = wrapper.get('input[aria-label="Playlist title"]');
        await field.setValue('Summer Roads');
        await field.trigger('keydown.enter');
        await flushPromises();

        expect(retitle).toHaveBeenCalledWith('Summer Roads');
    });

    it('opens a picked playlist directly when nothing is queued', async () =>
    {
        const store = useMediaPlayerStore();
        const openSpy = vi.spyOn(store, 'openPlaylistNode').mockResolvedValue({ resolved: 1, broken: 0 });

        const wrapper = mountPanel();
        await wrapper.get('button[aria-label="Open playlist"]').trigger('click');
        await nextTick();

        const picker = wrapper.findAllComponents(FilePickerStub)[1];
        picker?.vm.$emit('select', fileNode({ id: 'pl', name: 'mix.m3u8', mimeType: 'audio/x-mpegurl' }));
        await flushPromises();

        expect(openSpy).toHaveBeenCalledWith(expect.objectContaining({ id: 'pl' }), 'replace');
    });

    it('asks open-or-append when a queue is already playing, and appends on request', async () =>
    {
        const store = useMediaPlayerStore();
        store.open(fileNode({ id: 'a1' }), 'audio');
        const openSpy = vi.spyOn(store, 'openPlaylistNode').mockResolvedValue({ resolved: 1, broken: 0 });

        const wrapper = mountPanel();
        await wrapper.get('button[aria-label="Open playlist"]').trigger('click');
        await nextTick();

        const picker = wrapper.findAllComponents(FilePickerStub)[1];
        picker?.vm.$emit('select', fileNode({ id: 'pl', name: 'mix.m3u8', mimeType: 'audio/x-mpegurl' }));
        await nextTick();

        expect(openSpy).not.toHaveBeenCalled();
        expect(wrapper.text()).toContain('in place of the current queue');

        const append = wrapper.findAll('button').find((button) => button.text() === 'Append');
        await append?.trigger('click');
        await flushPromises();

        expect(openSpy).toHaveBeenCalledWith(expect.objectContaining({ id: 'pl' }), 'append');
    });
});

describe('MediaPlaylist add flow', () =>
{
    it('opens the picker modal constrained to media, and every pick appends while it stays open', async () =>
    {
        const store = useMediaPlayerStore();
        store.open(fileNode({ id: 'a1' }), 'audio');

        const wrapper = mountPanel();
        await addButton(wrapper).trigger('click');
        await nextTick();

        const modal = wrapper.get('.umodal');
        expect(modal.attributes('data-open')).toBe('true');

        const picker = wrapper.getComponent(FilePickerStub);
        expect(picker.props('accept')).toEqual([ 'audio/*', 'video/*' ]);

        picker.vm.$emit('select', fileNode({ id: 'a2', name: 'two.mp3' }));
        picker.vm.$emit('select', fileNode({ id: 'v1', name: 'clip.mp4', mimeType: 'video/mp4' }));
        await nextTick();

        expect(store.tracks.map((entry) => entry.nodeID)).toEqual([ 'a1', 'a2', 'v1' ]);
        expect(modal.attributes('data-open')).toBe('true');
    });

    it('shows the picker which rows are queued and keeps a running count in the caption', async () =>
    {
        const store = useMediaPlayerStore();
        store.open(fileNode({ id: 'a1' }), 'audio');
        store.add(fileNode({ id: 'a2' }));

        const wrapper = mountPanel();
        await addButton(wrapper).trigger('click');
        await nextTick();

        const picker = wrapper.getComponent(FilePickerStub);
        expect([ ...(picker.props('pickedIDs') as Set<string>) ]).toEqual([ 'a1', 'a2' ]);
        expect(picker.props('caption')).toContain('2 in playlist');
    });

    it('queues a whole folder from Add-all and reports what it added in the caption', async () =>
    {
        getChildrenMock.mockResolvedValue({
            nodes: [
                fileNode({ id: 'a2', name: 'two.mp3' }),
                fileNode({ id: 'v1', name: 'clip.mp4', mimeType: 'video/mp4' }),
            ],
            total: 2,
            limit: 200,
            offset: 0,
            owners: [],
        });

        const store = useMediaPlayerStore();
        store.open(fileNode({ id: 'a1' }), 'audio');

        const wrapper = mountPanel();
        await addButton(wrapper).trigger('click');
        await nextTick();

        const picker = wrapper.getComponent(FilePickerStub);
        picker.vm.$emit('select-folder', folderNode({ id: 'dir', name: 'Music' }));
        await flushPromises();

        expect(store.tracks.map((entry) => entry.nodeID)).toEqual([ 'a1', 'a2', 'v1' ]);
        expect(picker.props('caption')).toContain('added 2 from “Music”');
    });

    it('closes the picker on Done without touching the queue', async () =>
    {
        const store = useMediaPlayerStore();
        store.open(fileNode({ id: 'a1' }), 'audio');

        const wrapper = mountPanel();
        await addButton(wrapper).trigger('click');
        await nextTick();

        wrapper.getComponent(FilePickerStub).vm.$emit('cancel');
        await nextTick();

        expect(wrapper.get('.umodal').attributes('data-open')).toBe('false');
        expect(store.tracks.map((entry) => entry.nodeID)).toEqual([ 'a1' ]);
    });
});

//----------------------------------------------------------------------------------------------------------------------
