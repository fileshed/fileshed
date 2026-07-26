//----------------------------------------------------------------------------------------------------------------------
// Video Player — mount contract, controls state machine, and the unplayable-format fallback
//
// jsdom has no real media pipeline: HTMLMediaElement.play()/pause() are unimplemented stubs, duration and buffered
// stay fixed at their defaults, and no event fires on its own. play/pause are spied so togglePlay has something to
// call, and every other native event (play, pause, timeupdate, error) is dispatched directly at the element to drive
// the state machine the same way a real browser would. currentTime, volume, and playbackRate ARE real, settable
// properties in jsdom, so seeking and volume are asserted against the element itself, not just the emitted event.
//----------------------------------------------------------------------------------------------------------------------

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { type VueWrapper, mount } from '@vue/test-utils';

// Under test
import VideoPlayer from '@client/components/handlers/video/videoPlayer.vue';

//----------------------------------------------------------------------------------------------------------------------

const UButtonStub = {
    name: 'UButton',
    props: [ 'icon', 'label', 'variant', 'color', 'size', 'ariaLabel', 'href', 'download' ],
    emits: [ 'click' ],
    template: '<button :data-icon="icon" :aria-label="ariaLabel" :href="href" :download="download" '
        + '@click="$emit(\'click\')">{{ label }}</button>',
};

const UIconStub = { name: 'UIcon', props: [ 'name' ], template: '<i :data-icon="name" />' };

const stubs = { UButton: UButtonStub, UIcon: UIconStub };

beforeAll(() =>
{
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(() => Promise.resolve());
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => { /* jsdom has no real playback */ });
});

afterEach(() =>
{
    vi.clearAllMocks();
});

function mountPlayer(overrides : Partial<{ nodeID : string; name : string; mimeType : string }> = {}) : VueWrapper
{
    return mount(VideoPlayer, {
        props: { nodeID: 'node1', name: 'clip.mp4', mimeType: 'video/mp4', ...overrides },
        global: { stubs },
    });
}

//----------------------------------------------------------------------------------------------------------------------

describe('VideoPlayer source', () =>
{
    it('sources the video from the inline-download URL, typed with the node\'s mime type', () =>
    {
        const wrapper = mountPlayer({ nodeID: 'n42', mimeType: 'video/webm' });
        const source = wrapper.get('source');

        expect(source.attributes('src')).toBe('/api/nodes/n42/download?disposition=inline');
        expect(source.attributes('type')).toBe('video/webm');
    });
});

//----------------------------------------------------------------------------------------------------------------------

describe('VideoPlayer controls state machine', () =>
{
    it('calls play/pause on click but only flips state once the element confirms it', async () =>
    {
        const wrapper = mountPlayer();
        const video = wrapper.get('video').element as HTMLVideoElement;

        await wrapper.get('[aria-label="Play"]').trigger('click');
        expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(1);
        expect(wrapper.find('[aria-label="Play"]').exists()).toBe(true);

        video.dispatchEvent(new Event('play'));
        await wrapper.vm.$nextTick();
        expect(wrapper.find('[aria-label="Pause"]').exists()).toBe(true);

        await wrapper.get('[aria-label="Pause"]').trigger('click');
        expect(HTMLMediaElement.prototype.pause).toHaveBeenCalledTimes(1);

        video.dispatchEvent(new Event('pause'));
        await wrapper.vm.$nextTick();
        expect(wrapper.find('[aria-label="Play"]').exists()).toBe(true);
    });

    it('reflects ended playback as paused', async () =>
    {
        const wrapper = mountPlayer();
        const video = wrapper.get('video').element;

        video.dispatchEvent(new Event('play'));
        await wrapper.vm.$nextTick();

        video.dispatchEvent(new Event('ended'));
        await wrapper.vm.$nextTick();
        expect(wrapper.find('[aria-label="Play"]').exists()).toBe(true);
    });

    it('updates the time readout from timeupdate', async () =>
    {
        const wrapper = mountPlayer();
        const video = wrapper.get('video').element as HTMLVideoElement;

        video.currentTime = 42;
        video.dispatchEvent(new Event('timeupdate'));
        await wrapper.vm.$nextTick();

        expect(wrapper.text()).toContain('0:42');
    });

    it('seeks the real element when the scrub bar is dragged', async () =>
    {
        const wrapper = mountPlayer();
        const video = wrapper.get('video').element as HTMLVideoElement;

        // jsdom's own duration is a getter stuck at NaN; shadow it as an own property so the scrub bar's max isn't
        // clamped to zero, the same way a real browser's duration would be once metadata loads.
        Object.defineProperty(video, 'duration', { value: 120, configurable: true });
        video.dispatchEvent(new Event('loadedmetadata'));
        await wrapper.vm.$nextTick();

        await wrapper.get('input[aria-label="Seek"]').setValue('55');

        expect(video.currentTime).toBe(55);
    });

    it('sets the real element\'s volume when the volume slider is dragged', async () =>
    {
        const wrapper = mountPlayer();
        const video = wrapper.get('video').element as HTMLVideoElement;

        await wrapper.get('input[aria-label="Volume"]').setValue('0.3');

        expect(video.volume).toBe(0.3);
    });

    it('cycles the playback rate on the real element', async () =>
    {
        const wrapper = mountPlayer();
        const video = wrapper.get('video').element as HTMLVideoElement;

        await wrapper.get('[aria-label="Playback speed"]').trigger('click');

        expect(video.playbackRate).toBe(1.25);
        expect(wrapper.text()).toContain('1.25x');
    });

    it('does not throw toggling fullscreen when the Fullscreen API is unavailable', async () =>
    {
        const wrapper = mountPlayer();

        await expect(wrapper.get('[aria-label="Toggle fullscreen"]').trigger('click')).resolves.toBeUndefined();
    });
});

//----------------------------------------------------------------------------------------------------------------------

describe('VideoPlayer keyboard shortcuts', () =>
{
    it('toggles play with space', async () =>
    {
        const wrapper = mountPlayer();

        await wrapper.trigger('keydown', { key: ' ' });

        expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(1);
    });

    it('seeks forward and back with the horizontal arrows', async () =>
    {
        const wrapper = mountPlayer();
        const video = wrapper.get('video').element as HTMLVideoElement;

        await wrapper.trigger('keydown', { key: 'ArrowRight' });
        expect(video.currentTime).toBe(5);

        await wrapper.trigger('keydown', { key: 'ArrowLeft' });
        expect(video.currentTime).toBe(0);
    });

    it('adjusts volume with the vertical arrows', async () =>
    {
        const wrapper = mountPlayer();
        const video = wrapper.get('video').element as HTMLVideoElement;

        await wrapper.trigger('keydown', { key: 'ArrowDown' });
        expect(video.volume).toBeCloseTo(0.9);

        await wrapper.trigger('keydown', { key: 'ArrowUp' });
        await wrapper.trigger('keydown', { key: 'ArrowUp' });
        expect(video.volume).toBeCloseTo(1);
    });

    it('ignores a key with no assigned shortcut', async () =>
    {
        const wrapper = mountPlayer();
        const video = wrapper.get('video').element as HTMLVideoElement;

        await wrapper.trigger('keydown', { key: 'x' });

        expect(video.currentTime).toBe(0);
        expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled();
    });
});

//----------------------------------------------------------------------------------------------------------------------

describe('VideoPlayer unplayable format', () =>
{
    it('replaces the player with an in-card message and a Download affordance on an error event', async () =>
    {
        const wrapper = mountPlayer({ nodeID: 'n9', name: 'broken.mov' });
        const video = wrapper.get('video').element;

        video.dispatchEvent(new Event('error'));
        await wrapper.vm.$nextTick();

        expect(wrapper.find('video').exists()).toBe(false);
        expect(wrapper.text()).toContain('broken.mov can\'t be played here.');

        const download = wrapper.get('[data-icon="i-lucide-download"]');
        expect(download.attributes('href')).toBe('/api/nodes/n9/download');
        expect(download.attributes('download')).toBe('broken.mov');
    });
});

//----------------------------------------------------------------------------------------------------------------------
