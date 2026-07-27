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
import { type VueWrapper, flushPromises, mount } from '@vue/test-utils';

// Under test
import VideoPlayer from '@client/components/handlers/media/videoPlayer.vue';

//----------------------------------------------------------------------------------------------------------------------

const toastAdd = vi.hoisted(() => vi.fn());
vi.mock('@nuxt/ui/composables', () => ({ useToast: () => ({ add: toastAdd }) }));

const UButtonStub = {
    name: 'UButton',
    props: [ 'icon', 'label', 'variant', 'color', 'size', 'ariaLabel', 'href', 'download' ],
    emits: [ 'click' ],
    template: '<button :data-icon="icon" :aria-label="ariaLabel" :href="href" :download="download" '
        + '@click="$emit(\'click\')">{{ label }}</button>',
};

const UIconStub = { name: 'UIcon', props: [ 'name' ], template: '<i :data-icon="name" />' };

const UDropdownMenuStub = {
    name: 'UDropdownMenu',
    props: [ 'items' ],
    template: '<div class="rate-menu"><slot />'
        + '<button v-for="item in items.flat()" :key="item.label" :data-rate-item="item.label" '
        + '@click="item.onSelect()">{{ item.label }}</button></div>',
};

const stubs = { UButton: UButtonStub, UIcon: UIconStub, UDropdownMenu: UDropdownMenuStub };

beforeAll(() =>
{
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(() => Promise.resolve());
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => { /* jsdom has no real playback */ });
    vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => { /* jsdom has no real playback */ });
});

afterEach(() =>
{
    vi.clearAllMocks();
});

type PlayerProps = InstanceType<typeof VideoPlayer>['$props'];

function mountPlayer(overrides : Partial<PlayerProps> = {}) : VueWrapper
{
    return mount(VideoPlayer, {
        props: {
            src: '/api/nodes/node1/download?disposition=inline',
            downloadHref: '/api/nodes/node1/download',
            name: 'clip.mp4',
            mimeType: 'video/mp4',
            hasPrevious: false,
            hasNext: false,
            shuffle: false,
            repeat: 'off' as const,
            playlistHidden: false,
            autoplay: false,
            initialVolume: 1,
            initialMuted: false,
            initialRate: 1,
            ...overrides,
        },
        global: { stubs },
    });
}

//----------------------------------------------------------------------------------------------------------------------

describe('VideoPlayer source', () =>
{
    it('streams from the src it is handed, typed with the given mime', () =>
    {
        const wrapper = mountPlayer({ src: '/api/nodes/n42/download?disposition=inline', mimeType: 'video/webm' });
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

    it('sets the chosen playback rate on the real element', async () =>
    {
        const wrapper = mountPlayer();
        const video = wrapper.get('video').element as HTMLVideoElement;

        await wrapper.get('[data-rate-item="1.5x"]').trigger('click');

        expect(video.playbackRate).toBe(1.5);
        expect(wrapper.text()).toContain('1.5x');
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
        const wrapper = mountPlayer({ downloadHref: '/api/nodes/n9/download', name: 'broken.mov' });
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

describe('VideoPlayer queue behavior', () =>
{
    it('starts playback on mount only when the arriving track was queue-driven', () =>
    {
        mountPlayer({ autoplay: true });
        expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(1);

        vi.clearAllMocks();

        mountPlayer({ autoplay: false });
        expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled();
    });

    it('applies the listener\'s carried volume, mute, and rate to the fresh element', () =>
    {
        const wrapper = mountPlayer({ initialVolume: 0.4, initialMuted: true, initialRate: 1.5 });
        const video = wrapper.get('video').element as HTMLVideoElement;

        expect(video.volume).toBeCloseTo(0.4);
        expect(video.muted).toBe(true);
        expect(video.playbackRate).toBe(1.5);
    });

    it('emits ended when the track finishes, so the host can advance the queue', async () =>
    {
        const wrapper = mountPlayer();

        wrapper.get('video').element.dispatchEvent(new Event('ended'));
        await wrapper.vm.$nextTick();

        expect(wrapper.emitted('ended')).toHaveLength(1);
    });

    it('reports volume and rate changes so the host can carry them to the next track', async () =>
    {
        const wrapper = mountPlayer();
        const video = wrapper.get('video').element as HTMLVideoElement;

        video.volume = 0.3;
        video.dispatchEvent(new Event('volumechange'));
        video.playbackRate = 2;
        video.dispatchEvent(new Event('ratechange'));
        await wrapper.vm.$nextTick();

        expect(wrapper.emitted('volume-change')?.at(-1)).toEqual([ 0.3, false ]);
        expect(wrapper.emitted('rate-change')?.at(-1)).toEqual([ 2 ]);
    });

    it('emits error on a failed load, so the host can skip past it', async () =>
    {
        const wrapper = mountPlayer();

        wrapper.get('video').element.dispatchEvent(new Event('error'));
        await wrapper.vm.$nextTick();

        expect(wrapper.emitted('error')).toHaveLength(1);
    });

    it('omits the source type when the mime is unknown, letting the browser sniff instead of refusing', () =>
    {
        const wrapper = mountPlayer({ mimeType: null });

        expect(wrapper.get('source').attributes('type')).toBeUndefined();
    });

    it('stops playback and empties the element on unmount, so a discarded track aborts its fetch', () =>
    {
        const wrapper = mountPlayer();
        wrapper.unmount();

        expect(HTMLMediaElement.prototype.pause).toHaveBeenCalled();
        expect(HTMLMediaElement.prototype.load).toHaveBeenCalled();
    });
});

//----------------------------------------------------------------------------------------------------------------------

describe('VideoPlayer casting', () =>
{
    // jsdom media elements carry no `remote`; a fake Remote Playback surface is installed on the prototype for
    // these tests and torn down after. The button gates on watchAvailability -- for video sources Chrome answers
    // truthfully, and its false covers everything prompt() would fake as "dismissed" (unloaded metadata, media
    // under the 15-second remoting floor, no allowlisted device). Refused monitoring degrades to showing the
    // button and letting prompt() discover.
    function installFakeRemote(options : {
        available ?: boolean;
        monitoringSupported ?: boolean;
        promptError ?: DOMException;
    } = {}) : { prompt : ReturnType<typeof vi.fn> }
    {
        const prompt = vi.fn(() =>
        {
            return options.promptError ? Promise.reject(options.promptError) : Promise.resolve(undefined);
        });
        const remote = {
            state: 'disconnected',
            prompt,
            watchAvailability: (callback : (available : boolean) => void) =>
            {
                if(options.monitoringSupported === false)
                {
                    return Promise.reject(new DOMException('monitoring disabled', 'NotSupportedError'));
                }

                callback(options.available ?? true);
                return Promise.resolve(7);
            },
            cancelWatchAvailability: () => Promise.resolve(),
            addEventListener: () => { /* connect states exercised through the fake's disconnected default */ },
            removeEventListener: () => { /* torn down with the prototype patch */ },
        };
        Object.defineProperty(HTMLMediaElement.prototype, 'remote', { configurable: true, get: () => remote });

        return { prompt };
    }

    afterEach(() => { Reflect.deleteProperty(HTMLMediaElement.prototype, 'remote'); });

    it('offers Cast only once availability reports a device, prompting the native picker on click', async () =>
    {
        const { prompt } = installFakeRemote({ available: true });
        const wrapper = mountPlayer();
        await flushPromises();

        await wrapper.get('[aria-label="Cast"]').trigger('click');

        expect(prompt).toHaveBeenCalledTimes(1);
    });

    it('keeps the button hidden while availability says no device can play this', async () =>
    {
        installFakeRemote({ available: false });
        const wrapper = mountPlayer();
        await flushPromises();

        expect(wrapper.find('[aria-label="Cast"]').exists()).toBe(false);
    });

    it('degrades to prompt-driven discovery where availability monitoring is refused', async () =>
    {
        const { prompt } = installFakeRemote({ monitoringSupported: false });
        const wrapper = mountPlayer();
        await flushPromises();

        await wrapper.get('[aria-label="Cast"]').trigger('click');

        expect(prompt).toHaveBeenCalledTimes(1);
    });

    it('stays silent on a dismissed picker but names any real failure in a toast', async () =>
    {
        installFakeRemote({
            promptError: new DOMException('The prompt was dismissed.', 'NotAllowedError'),
        });
        const dismissed = mountPlayer();
        await flushPromises();
        await dismissed.get('[aria-label="Cast"]').trigger('click');
        await flushPromises();
        expect(toastAdd).not.toHaveBeenCalled();

        Reflect.deleteProperty(HTMLMediaElement.prototype, 'remote');
        installFakeRemote({
            promptError: new DOMException('No device found.', 'NotFoundError'),
        });
        const failed = mountPlayer();
        await flushPromises();
        await failed.get('[aria-label="Cast"]').trigger('click');
        await flushPromises();

        expect(toastAdd).toHaveBeenCalledWith(expect.objectContaining({
            description: 'No cast devices were found on the network.',
        }));
    });
});

//----------------------------------------------------------------------------------------------------------------------
