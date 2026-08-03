//----------------------------------------------------------------------------------------------------------------------
// Audio Controls — presentational transport row
//
// Purely props-in, emits-out: no media element involved. What this guards: the play/pause and volume icons track the
// props they're derived from, the buffered and played fills widen with their percentages, the time readout formats
// through the shared engine, and every control emits the action the player is expected to carry out -- from its button
// and, for the ones a narrow row drops, from the overflow menu as well. No fullscreen control exists here -- there is
// no visual surface to fill.
//----------------------------------------------------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';
import { type VueWrapper, mount } from '@vue/test-utils';

// Under test
import AudioControls from '@client/components/handlers/media/audioControls.vue';

//----------------------------------------------------------------------------------------------------------------------

const UButtonStub = {
    name: 'UButton',
    props: [ 'icon', 'label', 'variant', 'color', 'size', 'ariaLabel', 'disabled' ],
    emits: [ 'click' ],
    template: '<button :data-icon="icon" :aria-label="ariaLabel" :disabled="disabled" '
        + '@click="$emit(\'click\')">{{ label }}</button>',
};

// Renders every menu item as a button, submenu children included, so a test can click what a real menu would show.
const UDropdownMenuStub = {
    name: 'UDropdownMenu',
    props: [ 'items' ],
    computed: {
        entries()
        {
            return (this.items as { label : string; children ?: unknown[] }[][]).flat()
                .flatMap((item) => (item.children ?? [ item ]));
        },
    },
    template: '<div><slot />'
        + '<button v-for="item in entries" :key="item.label" :data-menuitem="item.label" '
        + '@click="item.onSelect && item.onSelect()">{{ item.label }}</button></div>',
};

const stubs = { UButton: UButtonStub, UDropdownMenu: UDropdownMenuStub, UIcon: true };

type Props = InstanceType<typeof AudioControls>['$props'];

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
        hasPrevious: false,
        hasNext: false,
        shuffle: false,
        repeat: 'off',
        castAvailable: false,
        casting: false,
    };
}

function mountControls(overrides : Partial<Props> = {}) : VueWrapper
{
    return mount(AudioControls, { props: { ...baseProps(), ...overrides }, global: { stubs } });
}

function seekFills(wrapper : VueWrapper) : { buffered : HTMLElement; played : HTMLElement }
{
    const input = wrapper.get('input[aria-label="Seek"]').element;
    const row = input.parentElement as HTMLElement;
    const divs = row.querySelectorAll(':scope > div');

    return { buffered: divs[1] as HTMLElement, played: divs[2] as HTMLElement };
}

// The row carries two menus; each is found by the button that opens it.
function menuFor(wrapper : VueWrapper, triggerLabel : string) : VueWrapper
{
    const menu = wrapper.findAllComponents({ name: 'UDropdownMenu' })
        .find((candidate) => candidate.find(`[aria-label="${ triggerLabel }"]`).exists());

    if(menu === undefined) { throw new Error(`No menu opened by "${ triggerLabel }"`); }

    return menu as VueWrapper;
}

function menuLabels(wrapper : VueWrapper, triggerLabel : string) : string[]
{
    return menuFor(wrapper, triggerLabel).findAll('[data-menuitem]')
        .map((item) => item.attributes('data-menuitem') ?? '');
}

//----------------------------------------------------------------------------------------------------------------------

describe('AudioControls', () =>
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

    it('shows the current playback rate and has no fullscreen control', () =>
    {
        const wrapper = mountControls({ playbackRate: 1.5 });

        expect(wrapper.text()).toContain('1.5x');
        expect(wrapper.find('[aria-label="Toggle fullscreen"]').exists()).toBe(false);
    });

    it('emits the matching action for each button', async () =>
    {
        const wrapper = mountControls();

        await wrapper.get('[aria-label="Play"]').trigger('click');
        await wrapper.get('[aria-label="Mute"]').trigger('click');

        expect(wrapper.emitted('toggle-play')).toHaveLength(1);
        expect(wrapper.emitted('toggle-mute')).toHaveLength(1);
    });

    it('offers the rate ladder as a menu and emits the chosen rate', async () =>
    {
        const wrapper = mountControls();

        await menuFor(wrapper, 'Playback speed').get('[data-menuitem="1.5x"]')
            .trigger('click');

        expect(wrapper.emitted('set-rate')).toEqual([ [ 1.5 ] ]);
    });

    it('offers Cast only where remote playback is available', async () =>
    {
        const absent = mountControls();
        expect(absent.find('[aria-label="Cast"]').exists()).toBe(false);

        const wrapper = mountControls({ castAvailable: true });
        await wrapper.get('[aria-label="Cast"]').trigger('click');
        expect(wrapper.emitted('cast')).toHaveLength(1);
    });

    it('emits shuffle and repeat toggles, and wears the repeat-one icon in that mode', async () =>
    {
        const wrapper = mountControls({ repeat: 'one' });

        await wrapper.get('[aria-label="Shuffle off"]').trigger('click');
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

// The card is narrower than the video bar at every width, so the same secondary controls move into a menu. Which ones
// are visible is styling and untestable here; what matters is that the menu reaches the same actions, and that play,
// the queue steps, and mute stay on the row.
describe('AudioControls overflow menu', () =>
{
    it('runs shuffle, repeat, and the rate ladder from the menu', async () =>
    {
        const wrapper = mountControls();
        const menu = menuFor(wrapper, 'More controls');

        await menu.get('[data-menuitem="Shuffle"]').trigger('click');
        await menu.get('[data-menuitem="Repeat: off"]').trigger('click');
        await menu.get('[data-menuitem="2x"]').trigger('click');

        expect(wrapper.emitted('toggle-shuffle')).toHaveLength(1);
        expect(wrapper.emitted('cycle-repeat')).toHaveLength(1);
        expect(wrapper.emitted('set-rate')).toEqual([ [ 2 ] ]);
    });

    it('names the repeat mode it will cycle from', () =>
    {
        expect(menuLabels(mountControls({ repeat: 'all' }), 'More controls')).toContain('Repeat: all');
    });

    it('checks the shuffle entry while shuffle is on', () =>
    {
        const items = menuFor(mountControls({ shuffle: true }), 'More controls').props('items') as
            { label : string; checked ?: boolean }[][];

        expect(items.flat().find((item) => item.label === 'Shuffle')?.checked).toBe(true);
    });

    it('offers Cast only where remote playback is available', async () =>
    {
        expect(menuLabels(mountControls(), 'More controls')).not.toContain('Cast');

        const wrapper = mountControls({ castAvailable: true });
        await menuFor(wrapper, 'More controls').get('[data-menuitem="Cast"]')
            .trigger('click');

        expect(wrapper.emitted('cast')).toHaveLength(1);
    });

    it('leaves play, the queue steps, and mute on the row', () =>
    {
        const labels = menuLabels(mountControls({ castAvailable: true, hasNext: true }), 'More controls');

        expect(labels).not.toContain('Play');
        expect(labels).not.toContain('Previous track');
        expect(labels).not.toContain('Next track');
        expect(labels).not.toContain('Mute');
    });
});

//----------------------------------------------------------------------------------------------------------------------

describe('AudioControls queue transport', () =>
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
