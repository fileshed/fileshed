//----------------------------------------------------------------------------------------------------------------------
// Media Player — the family host
//
// The contract: mounting opens the routed file as the playlist session and shows the surface its kind calls for
// (video canvas, or the audio card centered); a finished track advances to the next queued one, which starts on its
// own with the listener's carried volume/mute/rate; the transport's previous/next walk the queue; removing the last
// track leaves the empty invitation; and leaving the page resets the session. Real players over jsdom media
// elements — only play/pause are spied, every event is dispatched at the element.
//----------------------------------------------------------------------------------------------------------------------

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { type VueWrapper, enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import { createPinia, setActivePinia } from 'pinia';

import type { NodeResponse } from '@fileshed/core';

// Engines
import { queueFromTrack, trackFromUrl } from '@client/engines/media/queue.ts';

// Stores
import { useMediaPlayerStore } from '@client/stores/mediaPlayer.ts';
import { useSessionStore } from '@client/stores/session.ts';

// Support
import { meFixture } from '../../../support.ts';

// Under test
import MediaPlayer from '@client/components/handlers/media/mediaPlayer.vue';

//----------------------------------------------------------------------------------------------------------------------

const { readMediaTagsMock } = vi.hoisted(() => ({ readMediaTagsMock: vi.fn() }));

vi.mock('@client/resource-access/mediaTags.ts', () => ({
    readMediaTags: readMediaTagsMock,
    releaseMediaTags: vi.fn(),
}));

vi.mock('@client/resource-access/nodes.ts', () => ({
    getChildren: vi.fn(),

    // The identity bar reads the playing track's sharing off the node it fetches, so this has to answer a node.
    getNode: vi.fn(async (id : string) => ({ id, sharing: null })),
}));
vi.mock('@client/resource-access/blobs.ts', () => ({
    claimBlob: vi.fn(), uploadTicket: vi.fn(), answerChallenge: vi.fn(),
}));
vi.mock('@client/resource-access/content.ts', () => ({ fetchNodeBlob: vi.fn() }));
vi.mock('@client/resource-access/accessTokens.ts', () => ({
    mintPlaybackToken: vi.fn(() => Promise.reject(new Error('no token in this spec'))),
}));
vi.mock('@nuxt/ui/composables', () => ({ useToast: () => ({ add: vi.fn() }) }));

//----------------------------------------------------------------------------------------------------------------------

const ISO = '2026-07-01T00:00:00.000Z';

function fileNode(overrides : Partial<{ id : string; name : string; mimeType : string }> = {}) : NodeResponse
{
    return {
        sharing: null,
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

const stubs = {
    UButton: {
        name: 'UButton',
        props: [ 'icon', 'label', 'variant', 'color', 'size', 'ariaLabel', 'disabled', 'href', 'download' ],
        emits: [ 'click' ],
        template: '<button :data-icon="icon" :aria-label="ariaLabel" :disabled="disabled" '
            + '@click="$emit(\'click\')">{{ label }}</button>',
    },
    UIcon: { props: [ 'name' ], template: '<i :data-icon="name" />' },
    UDropdownMenu: { props: [ 'items' ], template: '<div class="rate-menu"><slot /></div>' },
    UModal: {
        props: [ 'open', 'title' ],
        template: '<div class="umodal" :data-open="String(open)"><slot name="body" /></div>',
    },
    FilePicker: {
        name: 'FilePicker',
        props: [ 'accept', 'caption', 'cancelLabel' ],
        emits: [ 'select', 'cancel' ],
        template: '<div class="file-picker" />',
    },
    EditorHeaderSlot: { template: '<div class="header-slot"><slot /></div>' },
    UTooltip: { props: [ 'text' ], template: '<span><slot /></span>' },
};

beforeAll(() =>
{
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(() => Promise.resolve());
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => { /* jsdom has no real playback */ });
    vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => { /* jsdom has no real playback */ });
});

function mountPlayer(node : NodeResponse, media : 'audio' | 'video' = 'audio') : VueWrapper
{
    return mount(MediaPlayer, { props: { node, media }, global: { stubs } });
}

// The host installs a window keydown listener per mount; without unmounting between tests, every prior host in
// the file keeps listening and playback shortcuts fire once per leaked instance.
enableAutoUnmount(afterEach);

beforeEach(() =>
{
    vi.clearAllMocks();
    readMediaTagsMock.mockResolvedValue(null);
    setActivePinia(createPinia());
});

//----------------------------------------------------------------------------------------------------------------------

describe('MediaPlayer surfaces', () =>
{
    // Safari hands an AirPlay receiver whatever URL the element holds, and the receiver has no cookie jar -- the
    // credential must ride the src itself.
    it('appends the session playback token to drive srcs', () =>
    {
        const store = useMediaPlayerStore();
        store.playbackToken = { id: 'k1', token: 'fsplay_sessionkey', expiresAt: Date.now() + 3_600_000 };

        const wrapper = mountPlayer(fileNode());
        const src = wrapper.get('audio').attributes('src') ?? '';

        expect(src).toContain('disposition=inline');
        expect(src).toContain('token=fsplay_sessionkey');
    });

    // The preference exists so the element never makes the request. Asserting on the src is asserting on exactly
    // that: an empty one is a fetch that does not happen.
    it('hands the element no src at all for a remote entry the reader has refused', async () =>
    {
        const session = useSessionStore();
        session.me = meFixture({ preferences: { allowRemoteMedia: false } });
        const store = useMediaPlayerStore();
        const wrapper = mountPlayer(fileNode());

        store.queue = queueFromTrack(trackFromUrl('https://radio.example/live.mp3'));
        await wrapper.vm.$nextTick();

        expect(wrapper.get('audio').attributes('src')).toBe('');
    });

    it('plays a remote entry while the reader allows remote media', async () =>
    {
        const session = useSessionStore();
        session.me = meFixture({ preferences: {} });
        const store = useMediaPlayerStore();
        const wrapper = mountPlayer(fileNode());

        store.queue = queueFromTrack(trackFromUrl('https://radio.example/live.mp3'));
        await wrapper.vm.$nextTick();

        expect(wrapper.get('audio').attributes('src')).toBe('https://radio.example/live.mp3');
    });

    it('opens the routed audio file as the session and mounts the audio card, not the video canvas', () =>
    {
        const wrapper = mountPlayer(fileNode({ id: 'a1', name: 'one.mp3' }));
        const store = useMediaPlayerStore();

        expect(store.track?.nodeID).toBe('a1');
        expect(wrapper.find('audio').exists()).toBe(true);
        expect(wrapper.find('video').exists()).toBe(false);
        expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled();
    });

    it('mounts the video canvas for a video file', () =>
    {
        const wrapper = mountPlayer(fileNode({ id: 'v1', mimeType: 'video/mp4' }), 'video');

        expect(wrapper.find('video').exists()).toBe(true);
        expect(wrapper.find('audio').exists()).toBe(false);
    });

    it('shows the empty invitation once the last track is removed', async () =>
    {
        const wrapper = mountPlayer(fileNode());
        const store = useMediaPlayerStore();

        store.removeTrack(0);
        await nextTick();

        expect(wrapper.find('audio').exists()).toBe(false);
        expect(wrapper.text()).toContain('The playlist is empty.');
    });

    it('dresses the audio surface with embedded artwork, title, artist, and album once read', async () =>
    {
        readMediaTagsMock.mockResolvedValue({
            title: 'Neon Skyline',
            artist: 'The Sample Band',
            album: 'Fixtures',
            artworkUrl: 'blob:fake-cover',
        });

        const wrapper = mountPlayer(fileNode({ id: 'a1', name: 'one.mp3' }));
        await flushPromises();

        expect(wrapper.get('img').attributes('src')).toBe('blob:fake-cover');
        expect(wrapper.text()).toContain('Neon Skyline');
        expect(wrapper.text()).toContain('The Sample Band');
        expect(wrapper.text()).toContain('Fixtures');
    });

    it('falls back to a placeholder and the filename when the file carries no tags', async () =>
    {
        const wrapper = mountPlayer(fileNode({ id: 'a1', name: 'one.mp3' }));
        await flushPromises();

        expect(wrapper.find('img').exists()).toBe(false);
        expect(wrapper.text()).toContain('one.mp3');
    });

    // Focus wanders on a media page -- a playlist row click strands it on that row's button -- so the shortcuts
    // listen at the window: playback keys work from anywhere on the page except typing surfaces.
    it('drives the player from window-level shortcuts, deferring to typing surfaces', async () =>
    {
        const wrapper = mountPlayer(fileNode());
        wrapper.element.ownerDocument.body.appendChild(wrapper.element);

        window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ' }));
        expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(1);

        const field = document.createElement('input');
        document.body.appendChild(field);
        field.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
        expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(1);

        field.remove();
        wrapper.unmount();
        window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ' }));
        expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(1);
    });

    it('resets the session when the page unmounts', () =>
    {
        const wrapper = mountPlayer(fileNode());
        const store = useMediaPlayerStore();

        wrapper.unmount();

        expect(store.track).toBeNull();
        expect(store.tracks).toEqual([]);
    });
});

//----------------------------------------------------------------------------------------------------------------------

describe('MediaPlayer queue playback', () =>
{
    it('advances to the next track on the same living element, the listener\'s volume riding along', async () =>
    {
        const wrapper = mountPlayer(fileNode({ id: 'a1' }));
        const store = useMediaPlayerStore();
        store.add(fileNode({ id: 'a2', name: 'two.mp3' }));
        await nextTick();

        const element = wrapper.get('audio').element as HTMLAudioElement;
        element.volume = 0.3;
        element.dispatchEvent(new Event('volumechange'));
        element.dispatchEvent(new Event('ended'));
        await nextTick();
        await nextTick();

        expect(store.track?.nodeID).toBe('a2');

        // The element persists across the advance -- that is what keeps fullscreen and cast sessions alive -- so
        // the listener's volume needs no carrying at all, and the new src is adopted with a reload.
        expect(wrapper.get('audio').element).toBe(element);
        expect(element.volume).toBeCloseTo(0.3);
        expect(HTMLMediaElement.prototype.load).toHaveBeenCalled();
        expect(HTMLMediaElement.prototype.play).toHaveBeenCalled();
    });

    it('stays on the last track when it ends with nothing queued after it', async () =>
    {
        const wrapper = mountPlayer(fileNode({ id: 'a1' }));
        const store = useMediaPlayerStore();

        wrapper.get('audio').element.dispatchEvent(new Event('ended'));
        await nextTick();

        expect(store.track?.nodeID).toBe('a1');
        expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled();
    });

    it('switches surface when the queue crosses from audio into video', async () =>
    {
        const wrapper = mountPlayer(fileNode({ id: 'a1' }));
        const store = useMediaPlayerStore();
        store.add(fileNode({ id: 'v1', name: 'clip.mp4', mimeType: 'video/mp4' }));
        await nextTick();

        wrapper.get('audio').element.dispatchEvent(new Event('ended'));
        await nextTick();

        expect(wrapper.find('audio').exists()).toBe(false);
        expect(wrapper.find('video').exists()).toBe(true);
    });

    it('keeps the playing track untouched when a row above it is removed', async () =>
    {
        const wrapper = mountPlayer(fileNode({ id: 'a1' }));
        const store = useMediaPlayerStore();
        store.add(fileNode({ id: 'a2' }));
        store.next();
        await nextTick();

        const playing = wrapper.get('audio').element;
        store.removeTrack(0);
        await nextTick();

        expect(store.track?.nodeID).toBe('a2');
        expect(wrapper.get('audio').element).toBe(playing);
    });

    it('skips past a track the browser cannot decode instead of stalling the queue', async () =>
    {
        const wrapper = mountPlayer(fileNode({ id: 'a1' }));
        const store = useMediaPlayerStore();
        store.add(fileNode({ id: 'a2' }));
        await nextTick();

        wrapper.get('audio').element.dispatchEvent(new Event('error'));
        await nextTick();

        expect(store.track?.nodeID).toBe('a2');
        expect(HTMLMediaElement.prototype.play).toHaveBeenCalled();
    });

    it('restarts the same track on the same element when it ends under repeat-one', async () =>
    {
        const wrapper = mountPlayer(fileNode({ id: 'a1' }));
        const store = useMediaPlayerStore();
        store.cycleRepeat();
        store.cycleRepeat();

        const element = wrapper.get('audio').element as HTMLAudioElement;
        element.currentTime = 100;
        element.dispatchEvent(new Event('ended'));
        await nextTick();
        await nextTick();

        expect(store.track?.nodeID).toBe('a1');
        expect(wrapper.get('audio').element).toBe(element);
        expect(element.currentTime).toBe(0);
        expect(HTMLMediaElement.prototype.play).toHaveBeenCalled();
    });

    it('hides the playlist from the video bar\'s toggle, bringing it back for audio tracks', async () =>
    {
        const wrapper = mountPlayer(fileNode({ id: 'v1', name: 'clip.mp4', mimeType: 'video/mp4' }), 'video');
        const store = useMediaPlayerStore();
        store.add(fileNode({ id: 'a1', name: 'one.mp3' }));
        await nextTick();

        expect(wrapper.text()).toContain('Playlist');

        await wrapper.get('button[aria-label="Hide playlist"]').trigger('click');
        expect(wrapper.text()).not.toContain('Playlist');

        store.next();
        await nextTick();

        expect(wrapper.text()).toContain('Playlist');
    });

    it('walks the queue from the transport\'s previous and next', async () =>
    {
        const wrapper = mountPlayer(fileNode({ id: 'a1' }));
        const store = useMediaPlayerStore();
        store.add(fileNode({ id: 'a2' }));
        await nextTick();

        await wrapper.get('button[aria-label="Next track"]').trigger('click');
        expect(store.track?.nodeID).toBe('a2');

        await wrapper.get('button[aria-label="Previous track"]').trigger('click');
        expect(store.track?.nodeID).toBe('a1');
    });
});

//----------------------------------------------------------------------------------------------------------------------
