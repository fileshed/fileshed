//----------------------------------------------------------------------------------------------------------------------
// Video Controls — presentational transport bar
//
// Purely props-in, emits-out: no media element involved. What this guards: the play/pause and volume icons track the
// props they're derived from, the buffered and played fills widen with their percentages, the time readout formats
// through the shared engine, and every control emits the action the player is expected to carry out.
//----------------------------------------------------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';
import { type VueWrapper, mount } from '@vue/test-utils';

// Under test
import VideoControls from '@client/components/handlers/media/videoControls.vue';

//----------------------------------------------------------------------------------------------------------------------

const UButtonStub = {
    name: 'UButton',
    props: [ 'icon', 'label', 'variant', 'color', 'size', 'ariaLabel', 'disabled' ],
    emits: [ 'click' ],
    template: '<button :data-icon="icon" :aria-label="ariaLabel" :disabled="disabled" '
        + '@click="$emit(\'click\')">{{ label }}</button>',
};

const UDropdownMenuStub = {
    name: 'UDropdownMenu',
    props: [ 'items' ],
    template: '<div class="rate-menu"><slot />'
        + '<button v-for="item in items.flat()" :key="item.label" :data-rate-item="item.label" '
        + '@click="item.onSelect()">{{ item.label }}</button></div>',
};

const stubs = { UButton: UButtonStub, UDropdownMenu: UDropdownMenuStub, UIcon: true };

type Props = InstanceType<typeof VideoControls>['$props'];

function baseProps() : Props
{
    return {
        playing: false,
        currentTime: 30,
        duration: 120,
        bufferedPercent: 50,
        volume: 1,
        muted: false,
        playbackRate: 1,
        isFullscreen: false,
        hasPrevious: false,
        hasNext: false,
        shuffle: false,
        repeat: 'off',
        castAvailable: false,
        casting: false,
        playlistHidden: false,
    };
}

function mountControls(overrides : Partial<Props> = {}) : VueWrapper
{
    return mount(VideoControls, { props: { ...baseProps(), ...overrides }, global: { stubs } });
}

// The seek row renders three plain divs in order (track, buffered fill, played fill) followed by the range input.
function seekFills(wrapper : VueWrapper) : { buffered : HTMLElement; played : HTMLElement }
{
    const input = wrapper.get('input[aria-label="Seek"]').element;
    const row = input.parentElement as HTMLElement;
    const divs = row.querySelectorAll(':scope > div');

    return { buffered: divs[1] as HTMLElement, played: divs[2] as HTMLElement };
}

//----------------------------------------------------------------------------------------------------------------------

describe('VideoControls', () =>
{
    it('shows the play icon when paused and the pause icon when playing', () =>
    {
        const paused = mountControls({ playing: false });
        expect(paused.get('[aria-label="Play"]').attributes('data-icon')).toBe('i-lucide-play');

        const playing = mountControls({ playing: true });
        expect(playing.get('[aria-label="Pause"]').attributes('data-icon')).toBe('i-lucide-pause');
    });

    it('formats the elapsed and total time through the shared engine', () =>
    {
        const wrapper = mountControls({ currentTime: 65, duration: 125 });

        expect(wrapper.text()).toContain('1:05 / 2:05');
    });

    it('sizes the buffered and played fills from their percentages', () =>
    {
        const wrapper = mountControls({ currentTime: 30, duration: 120, bufferedPercent: 75 });
        const { buffered, played } = seekFills(wrapper);

        expect(buffered.style.width).toBe('75%');
        expect(played.style.width).toBe('25%');
    });

    it('shows a muted icon when muted or silent, and a graduated icon otherwise', () =>
    {
        const volumeIcon = (overrides : Partial<Props>) : string | undefined =>
        {
            return mountControls(overrides).get('[data-icon^="i-lucide-volume"]')
                .attributes('data-icon');
        };

        expect(volumeIcon({ muted: true, volume: 1 })).toBe('i-lucide-volume-x');
        expect(volumeIcon({ muted: false, volume: 0 })).toBe('i-lucide-volume-x');
        expect(volumeIcon({ muted: false, volume: 0.2 })).toBe('i-lucide-volume-1');
        expect(volumeIcon({ muted: false, volume: 0.8 })).toBe('i-lucide-volume-2');
    });

    it('shows the current playback rate and the fullscreen state', () =>
    {
        const wrapper = mountControls({ playbackRate: 1.5, isFullscreen: true });

        expect(wrapper.text()).toContain('1.5x');
        expect(wrapper.get('[aria-label="Toggle fullscreen"]').attributes('data-icon')).toBe('i-lucide-minimize');
    });

    it('emits the matching action for each button', async () =>
    {
        const wrapper = mountControls();

        await wrapper.get('[aria-label="Play"]').trigger('click');
        await wrapper.get('[aria-label="Mute"]').trigger('click');
        await wrapper.get('[aria-label="Toggle fullscreen"]').trigger('click');

        expect(wrapper.emitted('toggle-play')).toHaveLength(1);
        expect(wrapper.emitted('toggle-mute')).toHaveLength(1);
        expect(wrapper.emitted('toggle-fullscreen')).toHaveLength(1);
    });

    it('offers the rate ladder as a menu and emits the chosen rate', async () =>
    {
        const wrapper = mountControls();

        await wrapper.get('[data-rate-item="2x"]').trigger('click');

        expect(wrapper.emitted('set-rate')).toEqual([ [ 2 ] ]);
    });

    it('offers Cast only where remote playback is available', async () =>
    {
        const absent = mountControls();
        expect(absent.find('[aria-label="Cast"]').exists()).toBe(false);

        const wrapper = mountControls({ castAvailable: true });
        await wrapper.get('[aria-label="Cast"]').trigger('click');
        expect(wrapper.emitted('cast')).toHaveLength(1);
    });

    it('toggles the playlist panel from beside fullscreen, its icon following the state', async () =>
    {
        const wrapper = mountControls();
        await wrapper.get('[aria-label="Hide playlist"]').trigger('click');
        expect(wrapper.emitted('toggle-playlist')).toHaveLength(1);

        const hidden = mountControls({ playlistHidden: true });
        expect(hidden.get('[aria-label="Show playlist"]').attributes('data-icon'))
            .toBe('i-lucide-panel-right-open');
    });

    it('emits shuffle and repeat toggles, and wears the repeat-one icon in that mode', async () =>
    {
        const wrapper = mountControls({ shuffle: true, repeat: 'one' });

        await wrapper.get('[aria-label="Shuffle on"]').trigger('click');
        await wrapper.get('[aria-label="Repeat one"]').trigger('click');

        expect(wrapper.emitted('toggle-shuffle')).toHaveLength(1);
        expect(wrapper.emitted('cycle-repeat')).toHaveLength(1);
        expect(wrapper.get('[aria-label="Repeat one"]').attributes('data-icon')).toBe('i-lucide-repeat-1');
    });

    it('emits a seek with the dragged time and a set-volume with the dragged level', async () =>
    {
        const wrapper = mountControls();

        await wrapper.get('input[aria-label="Seek"]').setValue('42');
        await wrapper.get('input[aria-label="Volume"]').setValue('0.4');

        expect(wrapper.emitted('seek')).toEqual([ [ 42 ] ]);
        expect(wrapper.emitted('set-volume')).toEqual([ [ 0.4 ] ]);
    });

    it('disables the seek bar until the duration is known', () =>
    {
        const wrapper = mountControls({ duration: 0 });

        expect(wrapper.get('input[aria-label="Seek"]').attributes('disabled')).toBeDefined();
    });
});

//----------------------------------------------------------------------------------------------------------------------

describe('VideoControls queue transport', () =>
{
    it('disables previous and next at the queue boundaries', () =>
    {
        const wrapper = mountControls({ hasPrevious: false, hasNext: false });

        expect(wrapper.get('button[aria-label="Previous track"]').attributes('disabled')).toBeDefined();
        expect(wrapper.get('button[aria-label="Next track"]').attributes('disabled')).toBeDefined();
    });

    it('emits previous and next when neighbours exist', async () =>
    {
        const wrapper = mountControls({ hasPrevious: true, hasNext: true });

        await wrapper.get('button[aria-label="Previous track"]').trigger('click');
        await wrapper.get('button[aria-label="Next track"]').trigger('click');

        expect(wrapper.emitted('previous')).toHaveLength(1);
        expect(wrapper.emitted('next')).toHaveLength(1);
    });
});

//----------------------------------------------------------------------------------------------------------------------
