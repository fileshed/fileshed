//----------------------------------------------------------------------------------------------------------------------
// Media Identity Bar — the header contribution
//
// The header names what is PLAYING: the current track's name and kind icon, with its place in the queue once more
// than one track is queued. It follows the queue, not the routed node, and teleports into the layout header target.
//----------------------------------------------------------------------------------------------------------------------

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { type VueWrapper, flushPromises, mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import { createPinia, setActivePinia } from 'pinia';

import type { NodeResponse } from '@fileshed/core';

// Engines
import { brokenTrack, queueFromTrack, trackFromUrl } from '@client/engines/media/queue.ts';

// Stores
import { useMediaPlayerStore } from '@client/stores/mediaPlayer.ts';

// Under test
import MediaIdentityBar from '@client/components/handlers/media/identityBar.vue';

//----------------------------------------------------------------------------------------------------------------------

const { readMediaTagsMock } = vi.hoisted(() => ({ readMediaTagsMock: vi.fn() }));

vi.mock('@client/resource-access/mediaTags.ts', () => ({
    readMediaTags: readMediaTagsMock,
    releaseMediaTags: vi.fn(),
}));

//----------------------------------------------------------------------------------------------------------------------

const ISO = '2026-07-01T00:00:00.000Z';
const HEADER_ID = 'editor-header-center';

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
    UIcon: { props: [ 'name' ], template: '<i :data-icon="name" />' },
    DownloadAction: { props: [ 'nodeID' ], template: '<a class="download" :data-node="nodeID" />' },
};

function makeTarget() : void
{
    const el = document.createElement('div');
    el.id = HEADER_ID;
    document.body.appendChild(el);
}

function header() : HTMLElement
{
    const el = document.getElementById(HEADER_ID);
    if(el === null) { throw new Error('header target missing'); }

    return el;
}

function mountBar() : VueWrapper
{
    return mount(MediaIdentityBar, { global: { stubs } });
}

beforeEach(() =>
{
    document.body.innerHTML = '';
    setActivePinia(createPinia());
    makeTarget();
    vi.clearAllMocks();
    readMediaTagsMock.mockResolvedValue(null);
});

//----------------------------------------------------------------------------------------------------------------------

describe('MediaIdentityBar', () =>
{
    it('names the current track with its kind icon, and follows the queue as it advances', async () =>
    {
        const store = useMediaPlayerStore();
        store.open(fileNode({ id: 'a1', name: 'one.mp3' }), 'audio');
        store.add(fileNode({ id: 'v1', name: 'clip.mp4', mimeType: 'video/mp4' }));

        mountBar();
        await nextTick();

        expect(header().textContent).toContain('one.mp3');
        expect(header().querySelector('[data-icon="i-lucide-music"]')).not.toBeNull();

        store.next();
        await nextTick();

        expect(header().textContent).toContain('clip.mp4');
        expect(header().querySelector('[data-icon="i-lucide-film"]')).not.toBeNull();
    });

    it('prefers the embedded tag title with the artist beside it over the filename', async () =>
    {
        readMediaTagsMock.mockResolvedValue({
            title: 'Neon Skyline',
            artist: 'The Sample Band',
            album: null,
            artworkUrl: null,
        });
        const store = useMediaPlayerStore();
        store.open(fileNode({ id: 'a1', name: 'one.mp3' }), 'audio');

        mountBar();
        await flushPromises();

        expect(header().textContent).toContain('Neon Skyline');
        expect(header().textContent).toContain('The Sample Band');
        expect(header().textContent).not.toContain('one.mp3');
    });

    it('shows the queue position only once more than one track is queued', async () =>
    {
        const store = useMediaPlayerStore();
        store.open(fileNode({ id: 'a1' }), 'audio');

        mountBar();
        await nextTick();
        expect(header().textContent).not.toContain('1 of 1');

        store.add(fileNode({ id: 'a2' }));
        store.next();
        await nextTick();

        expect(header().textContent).toContain('2 of 2');
    });

    it('points the download at the playing track, not the routed one, as the queue advances', async () =>
    {
        const store = useMediaPlayerStore();
        store.open(fileNode({ id: 'a1', name: 'one.mp3' }), 'audio');
        store.add(fileNode({ id: 'v1', name: 'clip.mp4', mimeType: 'video/mp4' }));

        mountBar();
        await nextTick();

        expect(header().querySelector('.download')
            ?.getAttribute('data-node')).toBe('a1');

        store.next();
        await nextTick();

        expect(header().querySelector('.download')
            ?.getAttribute('data-node')).toBe('v1');
    });

    // A remote stream is somebody else's URL and a broken row resolved to no node, so neither has bytes this server
    // could hand over.
    it('offers no download for a remote stream', async () =>
    {
        const store = useMediaPlayerStore();
        store.queue = queueFromTrack(trackFromUrl('https://radio.example/live.mp3'));

        mountBar();
        await nextTick();

        expect(header().querySelector('.download')).toBeNull();
    });

    it('offers no download for a broken playlist entry', async () =>
    {
        const store = useMediaPlayerStore();
        store.queue = queueFromTrack(brokenTrack('Ghost', '0'));

        mountBar();
        await nextTick();

        expect(header().querySelector('.download')).toBeNull();
    });
});

//----------------------------------------------------------------------------------------------------------------------
