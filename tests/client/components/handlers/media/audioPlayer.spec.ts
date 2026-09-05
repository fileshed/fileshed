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
import { type VueWrapper, flushPromises, mount } from '@vue/test-utils';

// Under test
import AudioPlayer from '@client/components/handlers/media/audioPlayer.vue';

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

type PlayerProps = InstanceType<typeof AudioPlayer>['$props'];

function mountPlayer(overrides : Partial<PlayerProps> = {}) : VueWrapper
{
    return mount(AudioPlayer, {
        props: {
            src: '/api/nodes/node1/download?disposition=inline',
            downloadHref: '/api/nodes/node1/download',
            name: 'track.mp3',
            playToken: 0,
            hasPrevious: false,
            hasNext: false,
            shuffle: false,
            repeat: 'off' as const,
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

describe('AudioPlayer source', () =>
{
    it('streams from the src it is handed, straight on the element', () =>
    {
        const wrapper = mountPlayer({ src: '/api/nodes/n42/download?disposition=inline' });

        expect(wrapper.get('audio').attributes('src')).toBe('/api/nodes/n42/download?disposition=inline');
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

    it('sets the chosen playback rate on the real element', async () =>
    {
        const wrapper = mountPlayer();
        const audio = wrapper.get('audio').element as HTMLAudioElement;

        await wrapper.get('[data-rate-item="1.5x"]').trigger('click');

        expect(audio.playbackRate).toBe(1.5);
        expect(wrapper.text()).toContain('1.5x');
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
        const wrapper = mountPlayer({ downloadHref: '/api/nodes/n9/download', name: 'broken.flac' });
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

describe('AudioPlayer queue behavior', () =>
{
    // The persistent-element contract: one unplayable track must not poison the next -- a new src arriving on the
    // living element clears the error fallback, reloads, and honours a queue-driven start.
    it('recovers from an unplayable track when the next src arrives on the same element', async () =>
    {
        const wrapper = mountPlayer();
        const audio = wrapper.get('audio').element;

        audio.dispatchEvent(new Event('error'));
        await wrapper.vm.$nextTick();
        expect(wrapper.text()).toContain('Can\'t be played here.');

        await wrapper.setProps({ src: '/api/nodes/n2/download?disposition=inline', playToken: 1, autoplay: true });
        await wrapper.vm.$nextTick();

        expect(wrapper.text()).not.toContain('Can\'t be played here.');
        expect(wrapper.get('audio').element).toBe(audio);
        expect(HTMLMediaElement.prototype.load).toHaveBeenCalled();
        expect(HTMLMediaElement.prototype.play).toHaveBeenCalled();
    });

    // A cast session starting rewrites the current track's src with a playback token, and the element has to
    // reload onto it. Pressing the cast button should hand the track over, not start it again -- so the position
    // and whether it was playing carry across. jsdom's load() is a stub and cannot reset currentTime itself, so
    // the reset a real element performs is done here before the metadata event that restores it.
    it('carries the position and playback across a src that changed only in its token', async () =>
    {
        const wrapper = mountPlayer({ src: '/api/nodes/n1/download?disposition=inline' });
        const media = wrapper.get('audio').element as HTMLMediaElement;

        media.currentTime = 42;
        media.dispatchEvent(new Event('timeupdate'));
        media.dispatchEvent(new Event('play'));
        vi.clearAllMocks();

        await wrapper.setProps({ src: '/api/nodes/n1/download?disposition=inline&token=fsplay_k1' });
        await wrapper.vm.$nextTick();

        expect(HTMLMediaElement.prototype.load).toHaveBeenCalled();
        expect(HTMLMediaElement.prototype.play).toHaveBeenCalled();

        media.currentTime = 0;
        media.dispatchEvent(new Event('loadedmetadata'));

        expect(media.currentTime).toBe(42);
    });

    it('starts a genuinely different track from the beginning, whatever the last one was at', async () =>
    {
        const wrapper = mountPlayer({ src: '/api/nodes/n1/download?disposition=inline' });
        const media = wrapper.get('audio').element as HTMLMediaElement;

        media.currentTime = 42;
        media.dispatchEvent(new Event('timeupdate'));

        await wrapper.setProps({ src: '/api/nodes/n2/download?disposition=inline' });
        await wrapper.vm.$nextTick();

        media.currentTime = 0;
        media.dispatchEvent(new Event('loadedmetadata'));

        expect(media.currentTime).toBe(0);
    });

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
        const audio = wrapper.get('audio').element as HTMLAudioElement;

        expect(audio.volume).toBeCloseTo(0.4);
        expect(audio.muted).toBe(true);
        expect(audio.playbackRate).toBe(1.5);
    });

    it('emits ended when the track finishes, so the host can advance the queue', async () =>
    {
        const wrapper = mountPlayer();

        wrapper.get('audio').element.dispatchEvent(new Event('ended'));
        await wrapper.vm.$nextTick();

        expect(wrapper.emitted('ended')).toHaveLength(1);
    });

    it('reports volume and rate changes so the host can carry them to the next track', async () =>
    {
        const wrapper = mountPlayer();
        const audio = wrapper.get('audio').element as HTMLAudioElement;

        audio.volume = 0.3;
        audio.dispatchEvent(new Event('volumechange'));
        audio.playbackRate = 2;
        audio.dispatchEvent(new Event('ratechange'));
        await wrapper.vm.$nextTick();

        expect(wrapper.emitted('volume-change')?.at(-1)).toEqual([ 0.3, false ]);
        expect(wrapper.emitted('rate-change')?.at(-1)).toEqual([ 2 ]);
    });

    it('emits error on a failed load, so the host can skip past it', async () =>
    {
        const wrapper = mountPlayer();

        wrapper.get('audio').element.dispatchEvent(new Event('error'));
        await wrapper.vm.$nextTick();

        expect(wrapper.emitted('error')).toHaveLength(1);
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

describe('AudioPlayer casting', () =>
{
    // jsdom media elements carry no `remote`; a fake Remote Playback surface is installed on the prototype for
    // these tests and torn down after. The button gates on watchAvailability: Chromium reports false forever for
    // audio-only media (its Cast sink filter requires a video codec), Safari's AirPlay backend reports audio
    // targets truthfully -- so the same gate hides the button where casting is impossible and shows it where it
    // works, with no browser sniffing. Refused monitoring degrades to showing the button and letting prompt()
    // discover.
    function installFakeRemote(options : {
        available ?: boolean;
        monitoringSupported ?: boolean;
        promptError ?: DOMException;
        state ?: string;
    } = {}) : { prompt : ReturnType<typeof vi.fn>; fire : (event : string) => void }
    {
        const prompt = vi.fn(() =>
        {
            return options.promptError ? Promise.reject(options.promptError) : Promise.resolve(undefined);
        });
        const listeners : Record<string, (() => void)[]> = {};
        const remote = {
            state: options.state ?? 'disconnected',
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
            addEventListener: (event : string, listener : () => void) =>
            {
                (listeners[event] ??= []).push(listener);
            },
            removeEventListener: () => { /* torn down with the prototype patch */ },
        };
        Object.defineProperty(HTMLMediaElement.prototype, 'remote', { configurable: true, get: () => remote });

        return { prompt, fire: (event : string) => { for(const listener of listeners[event] ?? []) { listener(); } } };
    }

    afterEach(() => { Reflect.deleteProperty(HTMLMediaElement.prototype, 'remote'); });

    // The playback key exists for a receiver, which fetches the URL itself and has no cookie jar. Asking for one
    // the moment the connection starts -- `connecting`, before it completes -- is what gets the token into the src
    // in time for the handoff.
    it('asks the host for a playback key as soon as a connection starts', async () =>
    {
        const { fire } = installFakeRemote({ available: true });
        const wrapper = mountPlayer();
        await flushPromises();

        fire('connecting');

        expect(wrapper.emitted('cast-start')).toHaveLength(1);
    });

    // A player mounting against a session that is already casting -- a track change remounts nothing, but a switch
    // between the audio and video families does.
    it('asks when it mounts against a session already connected', async () =>
    {
        installFakeRemote({ available: true, state: 'connected' });
        const wrapper = mountPlayer();
        await flushPromises();

        expect(wrapper.emitted('cast-start')).toHaveLength(1);
    });

    it('asks for nothing while nothing is casting', async () =>
    {
        installFakeRemote({ available: true });
        const wrapper = mountPlayer();
        await flushPromises();

        expect(wrapper.emitted('cast-start')).toBeUndefined();
    });

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
