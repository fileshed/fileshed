//----------------------------------------------------------------------------------------------------------------------
// Audio Player — mount contract, controls state machine, and the unplayable-format fallback
//
// jsdom has no real media pipeline: HTMLMediaElement.play()/pause() are unimplemented stubs, duration and buffered
// stay fixed at their defaults, and no event fires on its own. play/pause are spied so togglePlay has something to
// call, and every other native event (play, pause, timeupdate, error) is dispatched directly at the element to drive
// the state machine the same way a real browser would. currentTime and volume ARE real, settable properties in
// jsdom, so seeking and volume are asserted against the element itself, not just the emitted event.
//----------------------------------------------------------------------------------------------------------------------

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { type VueWrapper, mount } from '@vue/test-utils';

// Under test
import AudioPlayer from '@client/components/handlers/audio/audioPlayer.vue';

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
    return mount(AudioPlayer, {
        props: { nodeID: 'node1', name: 'track.mp3', mimeType: 'audio/mpeg', ...overrides },
        global: { stubs },
    });
}

//----------------------------------------------------------------------------------------------------------------------

describe('AudioPlayer source', () =>
{
    it('sources the audio from the inline-download URL, typed with the node\'s mime type', () =>
    {
        const wrapper = mountPlayer({ nodeID: 'n42', mimeType: 'audio/ogg' });
        const source = wrapper.get('source');

        expect(source.attributes('src')).toBe('/api/nodes/n42/download?disposition=inline');
        expect(source.attributes('type')).toBe('audio/ogg');
    });

    // The file name rides the layout header now, not the card -- the transport is all the card carries, so it does not
    // repeat the name below it.
    it('carries no in-card title, leaving the name to the layout header', () =>
    {
        const wrapper = mountPlayer({ name: 'field-recording.wav' });

        expect(wrapper.text()).not.toContain('field-recording.wav');
    });
});

//----------------------------------------------------------------------------------------------------------------------

describe('AudioPlayer controls state machine', () =>
{
    it('calls play/pause on click but only flips state once the element confirms it', async () =>
    {
        const wrapper = mountPlayer();
        const audio = wrapper.get('audio').element as HTMLAudioElement;

        await wrapper.get('[aria-label="Play"]').trigger('click');
        expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(1);
        expect(wrapper.find('[aria-label="Play"]').exists()).toBe(true);

        audio.dispatchEvent(new Event('play'));
        await wrapper.vm.$nextTick();
        expect(wrapper.find('[aria-label="Pause"]').exists()).toBe(true);

        await wrapper.get('[aria-label="Pause"]').trigger('click');
        expect(HTMLMediaElement.prototype.pause).toHaveBeenCalledTimes(1);

        audio.dispatchEvent(new Event('pause'));
        await wrapper.vm.$nextTick();
        expect(wrapper.find('[aria-label="Play"]').exists()).toBe(true);
    });

    it('updates the time readout from timeupdate', async () =>
    {
        const wrapper = mountPlayer();
        const audio = wrapper.get('audio').element as HTMLAudioElement;

        audio.currentTime = 42;
        audio.dispatchEvent(new Event('timeupdate'));
        await wrapper.vm.$nextTick();

        expect(wrapper.text()).toContain('0:42');
    });

    it('seeks the real element when the scrub bar is dragged', async () =>
    {
        const wrapper = mountPlayer();
        const audio = wrapper.get('audio').element as HTMLAudioElement;

        // jsdom's own duration is a getter stuck at NaN; shadow it as an own property so the scrub bar's max isn't
        // clamped to zero, the same way a real browser's duration would be once metadata loads.
        Object.defineProperty(audio, 'duration', { value: 180, configurable: true });
        audio.dispatchEvent(new Event('loadedmetadata'));
        await wrapper.vm.$nextTick();

        await wrapper.get('input[aria-label="Seek"]').setValue('90');

        expect(audio.currentTime).toBe(90);
    });

    it('sets the real element\'s volume when the volume slider is dragged', async () =>
    {
        const wrapper = mountPlayer();
        const audio = wrapper.get('audio').element as HTMLAudioElement;

        await wrapper.get('input[aria-label="Volume"]').setValue('0.3');

        expect(audio.volume).toBe(0.3);
    });

    it('cycles the playback rate on the real element', async () =>
    {
        const wrapper = mountPlayer();
        const audio = wrapper.get('audio').element as HTMLAudioElement;

        await wrapper.get('[aria-label="Playback speed"]').trigger('click');

        expect(audio.playbackRate).toBe(1.25);
        expect(wrapper.text()).toContain('1.25x');
    });
});

//----------------------------------------------------------------------------------------------------------------------

describe('AudioPlayer keyboard shortcuts', () =>
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
        const audio = wrapper.get('audio').element as HTMLAudioElement;

        await wrapper.trigger('keydown', { key: 'ArrowRight' });
        expect(audio.currentTime).toBe(5);

        await wrapper.trigger('keydown', { key: 'ArrowLeft' });
        expect(audio.currentTime).toBe(0);
    });

    it('adjusts volume with the vertical arrows', async () =>
    {
        const wrapper = mountPlayer();
        const audio = wrapper.get('audio').element as HTMLAudioElement;

        await wrapper.trigger('keydown', { key: 'ArrowDown' });
        expect(audio.volume).toBeCloseTo(0.9);
    });
});

//----------------------------------------------------------------------------------------------------------------------

describe('AudioPlayer unplayable format', () =>
{
    it('replaces the transport with an in-card message and a Download affordance on an error event', async () =>
    {
        const wrapper = mountPlayer({ nodeID: 'n9', name: 'broken.flac' });
        const audio = wrapper.get('audio').element;

        audio.dispatchEvent(new Event('error'));
        await wrapper.vm.$nextTick();

        expect(wrapper.find('[aria-label="Play"]').exists()).toBe(false);
        expect(wrapper.text()).toContain('Can\'t be played here.');

        const download = wrapper.get('[data-icon="i-lucide-download"]');
        expect(download.attributes('href')).toBe('/api/nodes/n9/download');
        expect(download.attributes('download')).toBe('broken.flac');
    });
});

//----------------------------------------------------------------------------------------------------------------------
