<!----------------------------------------------------------------------------------------------------------------------
  -- Media Controls
  --
  -- The card variant sits in the app chrome under an audio track; the overlay variant sits on the video image, so it
  -- is painted fixed dark regardless of the app's light/dark mode. The trailing slot holds the controls only one
  -- player has, after the rest of the bar.
  --------------------------------------------------------------------------------------------------------------------->

<template>
    <div :class="[ 'flex flex-col gap-1.5', styles.root ]">
        <div
            :class="[
                'relative flex h-4 w-full items-center rounded-full has-[:focus-visible]:outline-2',
                'has-[:focus-visible]:outline-offset-2',
                styles.focusRing,
            ]"
        >
            <div
                :class="[
                    'pointer-events-none absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded-full',
                    styles.track,
                ]"
            />
            <div
                :class="[
                    'pointer-events-none absolute left-0 top-1/2 h-1 -translate-y-1/2 rounded-full',
                    styles.buffered,
                ]"
                :style="{ width: `${ bufferedPercent }%` }"
            />
            <div
                :class="[ 'pointer-events-none absolute left-0 top-1/2 h-1 -translate-y-1/2 rounded-full', styles.fill ]"
                :style="{ width: `${ playedPercent }%` }"
            />
            <input
                type="range"
                class="absolute inset-x-0 h-4 w-full cursor-pointer opacity-0"
                min="0"
                :max="duration > 0 ? duration : 0"
                step="0.1"
                :value="currentTime"
                :disabled="duration <= 0"
                aria-label="Seek"
                @input="onSeekInput"
            >
        </div>

        <div :class="[ 'flex items-center gap-1', styles.row ]">
            <UButton
                icon="i-lucide-shuffle"
                :color="shuffle ? 'primary' : 'neutral'"
                variant="ghost"
                size="sm"
                :class="[ 'hidden sm:inline-flex', styles.button ]"
                :aria-label="shuffle ? 'Shuffle on' : 'Shuffle off'"
                @click="emit('toggle-shuffle')"
            />
            <UButton
                icon="i-lucide-skip-back"
                color="neutral"
                variant="ghost"
                size="sm"
                :class="styles.button"
                :disabled="!hasPrevious"
                aria-label="Previous track"
                @click="emit('previous')"
            />
            <UButton
                :icon="playing ? 'i-lucide-pause' : 'i-lucide-play'"
                color="neutral"
                variant="ghost"
                size="sm"
                :class="styles.button"
                :aria-label="playing ? 'Pause' : 'Play'"
                @click="emit('toggle-play')"
            />
            <UButton
                icon="i-lucide-skip-forward"
                color="neutral"
                variant="ghost"
                size="sm"
                :class="styles.button"
                :disabled="!hasNext"
                aria-label="Next track"
                @click="emit('next')"
            />
            <UButton
                :icon="repeat === 'one' ? 'i-lucide-repeat-1' : 'i-lucide-repeat'"
                :color="repeat === 'off' ? 'neutral' : 'primary'"
                variant="ghost"
                size="sm"
                :class="[ 'hidden sm:inline-flex', styles.button ]"
                :aria-label="`Repeat ${ repeat }`"
                @click="emit('cycle-repeat')"
            />

            <span :class="[ 'ml-1 text-xs tabular-nums', styles.time ]">
                {{ formatMediaTime(currentTime) }} / {{ formatMediaTime(duration) }}
            </span>

            <div class="ml-auto flex items-center gap-1">
                <UButton
                    v-if="castAvailable"
                    icon="i-lucide-cast"
                    :color="casting ? 'primary' : 'neutral'"
                    variant="ghost"
                    size="sm"
                    :class="[ 'hidden sm:inline-flex', styles.button ]"
                    :aria-label="casting ? 'Casting' : 'Cast'"
                    @click="emit('cast')"
                />
                <UButton
                    :icon="volumeIcon"
                    color="neutral"
                    variant="ghost"
                    size="sm"
                    :class="styles.button"
                    :aria-label="muted || volume === 0 ? 'Unmute' : 'Mute'"
                    @click="emit('toggle-mute')"
                />

                <div
                    :class="[
                        'relative hidden h-4 w-16 items-center rounded-full has-[:focus-visible]:outline-2',
                        'has-[:focus-visible]:outline-offset-2 sm:flex',
                        styles.focusRing,
                    ]"
                >
                    <div
                        :class="[
                            'pointer-events-none absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded-full',
                            styles.track,
                        ]"
                    />
                    <div
                        :class="[
                            'pointer-events-none absolute left-0 top-1/2 h-1 -translate-y-1/2 rounded-full',
                            styles.fill,
                        ]"
                        :style="{ width: `${ (muted ? 0 : volume) * 100 }%` }"
                    />
                    <input
                        type="range"
                        class="absolute inset-x-0 h-4 w-full cursor-pointer opacity-0"
                        min="0"
                        max="1"
                        step="0.05"
                        :value="muted ? 0 : volume"
                        aria-label="Volume"
                        @input="onVolumeInput"
                    >
                </div>

                <UDropdownMenu :items="rateItems">
                    <UButton
                        :label="`${ playbackRate }x`"
                        color="neutral"
                        variant="ghost"
                        size="sm"
                        :class="[ 'hidden sm:inline-flex', styles.button ]"
                        aria-label="Playback speed"
                    />
                </UDropdownMenu>

                <UDropdownMenu :items="overflowItems">
                    <UButton
                        icon="i-lucide-ellipsis-vertical"
                        color="neutral"
                        variant="ghost"
                        size="sm"
                        :class="[ 'sm:hidden', styles.button ]"
                        aria-label="More controls"
                    />
                </UDropdownMenu>

                <slot name="trailing" />
            </div>
        </div>
    </div>
</template>

<!--------------------------------------------------------------------------------------------------------------------->

<script setup lang="ts">
    import { computed } from 'vue';
    import type { DropdownMenuItem } from '@nuxt/ui';

    // Engines
    import { PLAYBACK_RATES, formatMediaTime } from '../../../engines/media/playback.ts';
    import type { RepeatMode } from '../../../engines/media/queue.ts';

    //------------------------------------------------------------------------------------------------------------------

    type MediaControlsVariant = 'card' | 'overlay';

    interface VariantStyle
    {
        root : string;
        focusRing : string;
        track : string;
        buffered : string;
        fill : string;
        row : string;
        button : string;
        time : string;
    }

    // The card's bar baselines use the accented tokens because the muted ones vanish against the elevated card.
    const VARIANT_STYLES : Record<MediaControlsVariant, VariantStyle> = {
        card: {
            root: '',
            focusRing: 'has-[:focus-visible]:outline-primary',
            track: 'bg-accented',
            buffered: 'bg-primary/30',
            fill: 'bg-primary',
            row: '',
            button: '',
            time: 'text-dimmed',
        },
        overlay: {
            root: 'bg-black/70 px-3 py-2 backdrop-blur-sm',
            focusRing: 'has-[:focus-visible]:outline-white',
            track: 'bg-white/25',
            buffered: 'bg-white/40',
            fill: 'bg-white',
            row: 'text-white',
            button: 'focus-visible:outline-white',
            time: 'text-neutral-300',
        },
    };

    const props = defineProps<{
        variant : MediaControlsVariant;
        playing : boolean;
        currentTime : number;
        duration : number;
        bufferedPercent : number;
        volume : number;
        muted : boolean;
        playbackRate : number;
        hasPrevious : boolean;
        hasNext : boolean;
        shuffle : boolean;
        repeat : RepeatMode;
        castAvailable : boolean;
        casting : boolean;
    }>();

    const emit = defineEmits<{
        'toggle-play' : [];
        'seek' : [ time : number ];
        'toggle-mute' : [];
        'set-volume' : [ value : number ];
        'set-rate' : [ rate : number ];
        'previous' : [];
        'next' : [];
        'toggle-shuffle' : [];
        'cycle-repeat' : [];
        'cast' : [];
    }>();

    //------------------------------------------------------------------------------------------------------------------

    const styles = computed(() => VARIANT_STYLES[props.variant]);

    const playedPercent = computed(() =>
    {
        return props.duration > 0 ? (props.currentTime / props.duration) * 100 : 0;
    });

    const volumeIcon = computed(() =>
    {
        if(props.muted || props.volume === 0) { return 'i-lucide-volume-x'; }

        return props.volume < 0.5 ? 'i-lucide-volume-1' : 'i-lucide-volume-2';
    });

    const rateItems = computed<DropdownMenuItem[][]>(() => [
        PLAYBACK_RATES.map((rate) => ({
            label: `${ rate }x`,
            type: 'checkbox' as const,
            checked: rate === props.playbackRate,
            onSelect: () => { emit('set-rate', rate); },
        })),
    ]);

    // The narrow-viewport home for the controls the bar drops. Repeat cycles from here exactly as its button does --
    // the player only knows how to advance the mode, not to set one.
    const overflowItems = computed<DropdownMenuItem[][]>(() =>
    {
        const groups : DropdownMenuItem[][] = [
            [
                {
                    label: 'Shuffle',
                    icon: 'i-lucide-shuffle',
                    type: 'checkbox' as const,
                    checked: props.shuffle,
                    onSelect: () => { emit('toggle-shuffle'); },
                },
                {
                    label: `Repeat: ${ props.repeat }`,
                    icon: props.repeat === 'one' ? 'i-lucide-repeat-1' : 'i-lucide-repeat',
                    onSelect: () => { emit('cycle-repeat'); },
                },
            ],
            [ { label: 'Speed', icon: 'i-lucide-gauge', children: rateItems.value[0] } ],
        ];

        if(props.castAvailable)
        {
            groups.push([ {
                label: props.casting ? 'Casting' : 'Cast',
                icon: 'i-lucide-cast',
                onSelect: () => { emit('cast'); },
            } ]);
        }

        return groups;
    });

    function onSeekInput(event : Event) : void
    {
        emit('seek', Number((event.target as HTMLInputElement).value));
    }

    function onVolumeInput(event : Event) : void
    {
        emit('set-volume', Number((event.target as HTMLInputElement).value));
    }
</script>

<!--------------------------------------------------------------------------------------------------------------------->
