<!----------------------------------------------------------------------------------------------------------------------
  -- Video Controls
  --
  -- The transport bar overlaid on the video: a full-width scrub bar showing both playback progress and how far the
  -- browser has buffered ahead, then shuffle, previous/next over the playlist, play/pause, repeat, elapsed/total
  -- time, volume, a playback-rate menu, and fullscreen. Narrow viewports keep the transport, mute, the playlist
  -- toggle, and fullscreen on the bar and fold the rest into an overflow menu that carries the same emits its
  -- buttons do. Presentational only -- it holds no media state of its own, reading everything from props and
  -- asking the player to act via emits. Painted fixed-dark-on-black regardless of
  -- the app's own light/dark mode, since it sits on the video image itself rather than the app chrome (the same
  -- reasoning the text editor's gutter uses to opt out of the chosen colorscheme).
  --------------------------------------------------------------------------------------------------------------------->

<template>
    <div class="flex flex-col gap-1.5 bg-black/70 px-3 py-2 backdrop-blur-sm">
        <div
            class="relative flex h-4 w-full items-center rounded-full has-[:focus-visible]:outline-2
                has-[:focus-visible]:outline-white has-[:focus-visible]:outline-offset-2"
        >
            <div class="pointer-events-none absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-white/25" />
            <div
                class="pointer-events-none absolute left-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-white/40"
                :style="{ width: `${ bufferedPercent }%` }"
            />
            <div
                class="pointer-events-none absolute left-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-white"
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

        <div class="flex items-center gap-1 text-white">
            <UButton
                icon="i-lucide-shuffle"
                :color="shuffle ? 'primary' : 'neutral'"
                variant="ghost"
                size="sm"
                class="hidden focus-visible:outline-white sm:inline-flex"
                :aria-label="shuffle ? 'Shuffle on' : 'Shuffle off'"
                @click="emit('toggle-shuffle')"
            />
            <UButton
                icon="i-lucide-skip-back"
                color="neutral"
                variant="ghost"
                size="sm"
                class="focus-visible:outline-white"
                :disabled="!hasPrevious"
                aria-label="Previous track"
                @click="emit('previous')"
            />
            <UButton
                :icon="playing ? 'i-lucide-pause' : 'i-lucide-play'"
                color="neutral"
                variant="ghost"
                size="sm"
                class="focus-visible:outline-white"
                :aria-label="playing ? 'Pause' : 'Play'"
                @click="emit('toggle-play')"
            />
            <UButton
                icon="i-lucide-skip-forward"
                color="neutral"
                variant="ghost"
                size="sm"
                class="focus-visible:outline-white"
                :disabled="!hasNext"
                aria-label="Next track"
                @click="emit('next')"
            />
            <UButton
                :icon="repeat === 'one' ? 'i-lucide-repeat-1' : 'i-lucide-repeat'"
                :color="repeat === 'off' ? 'neutral' : 'primary'"
                variant="ghost"
                size="sm"
                class="hidden focus-visible:outline-white sm:inline-flex"
                :aria-label="`Repeat ${ repeat }`"
                @click="emit('cycle-repeat')"
            />

            <span class="ml-1 text-xs tabular-nums text-neutral-300">
                {{ formatMediaTime(currentTime) }} / {{ formatMediaTime(duration) }}
            </span>

            <div class="ml-auto flex items-center gap-1">
                <UButton
                    v-if="castAvailable"
                    icon="i-lucide-cast"
                    :color="casting ? 'primary' : 'neutral'"
                    variant="ghost"
                    size="sm"
                    class="hidden focus-visible:outline-white sm:inline-flex"
                    :aria-label="casting ? 'Casting' : 'Cast'"
                    @click="emit('cast')"
                />
                <UButton
                    :icon="volumeIcon"
                    color="neutral"
                    variant="ghost"
                    size="sm"
                    class="focus-visible:outline-white"
                    :aria-label="muted || volume === 0 ? 'Unmute' : 'Mute'"
                    @click="emit('toggle-mute')"
                />

                <div
                    class="relative hidden h-4 w-16 items-center rounded-full has-[:focus-visible]:outline-2
                        has-[:focus-visible]:outline-white has-[:focus-visible]:outline-offset-2 sm:flex"
                >
                    <div
                        class="pointer-events-none absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded-full
                            bg-white/25"
                    />
                    <div
                        class="pointer-events-none absolute left-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-white"
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
                        class="hidden focus-visible:outline-white sm:inline-flex"
                        aria-label="Playback speed"
                    />
                </UDropdownMenu>

                <UDropdownMenu :items="overflowItems">
                    <UButton
                        icon="i-lucide-ellipsis-vertical"
                        color="neutral"
                        variant="ghost"
                        size="sm"
                        class="focus-visible:outline-white sm:hidden"
                        aria-label="More controls"
                    />
                </UDropdownMenu>

                <UButton
                    :icon="playlistHidden ? 'i-lucide-panel-right-open' : 'i-lucide-panel-right-close'"
                    color="neutral"
                    variant="ghost"
                    size="sm"
                    class="focus-visible:outline-white"
                    :aria-label="playlistHidden ? 'Show playlist' : 'Hide playlist'"
                    @click="emit('toggle-playlist')"
                />

                <UButton
                    :icon="isFullscreen ? 'i-lucide-minimize' : 'i-lucide-maximize'"
                    color="neutral"
                    variant="ghost"
                    size="sm"
                    class="focus-visible:outline-white"
                    aria-label="Toggle fullscreen"
                    @click="emit('toggle-fullscreen')"
                />
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

    const props = defineProps<{
        playing : boolean;
        currentTime : number;
        duration : number;
        bufferedPercent : number;
        volume : number;
        muted : boolean;
        playbackRate : number;
        isFullscreen : boolean;
        hasPrevious : boolean;
        hasNext : boolean;
        shuffle : boolean;
        repeat : RepeatMode;
        castAvailable : boolean;
        casting : boolean;
        playlistHidden : boolean;
    }>();

    const emit = defineEmits<{
        'toggle-play' : [];
        'seek' : [ time : number ];
        'toggle-mute' : [];
        'set-volume' : [ value : number ];
        'set-rate' : [ rate : number ];
        'toggle-fullscreen' : [];
        'previous' : [];
        'next' : [];
        'toggle-shuffle' : [];
        'cycle-repeat' : [];
        'cast' : [];
        'toggle-playlist' : [];
    }>();

    //------------------------------------------------------------------------------------------------------------------

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
