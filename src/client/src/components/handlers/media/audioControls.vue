<!----------------------------------------------------------------------------------------------------------------------
  -- Audio Controls
  --
  -- The transport rows inside the compact audio card: a full-width scrub bar showing playback progress and how far
  -- the browser has buffered ahead, then shuffle, previous/next over the playlist, play/pause, repeat,
  -- elapsed/total time, an availability-gated cast button, volume, and a playback-rate menu -- the same transport
  -- the video side exposes, minus fullscreen, which has no meaning without a visual surface. Presentational only -- it holds no media state of its
  -- own, reading everything from props and asking the player to act via emits. Styled with the app's own semantic
  -- tokens rather than a fixed dark bar; the bar baselines use the accented tokens because the muted ones vanish
  -- against the elevated card.
  --------------------------------------------------------------------------------------------------------------------->

<template>
    <div class="flex flex-col gap-1.5">
        <div
            class="relative flex h-4 w-full items-center rounded-full has-[:focus-visible]:outline-2
                has-[:focus-visible]:outline-primary has-[:focus-visible]:outline-offset-2"
        >
            <div class="pointer-events-none absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-accented" />
            <div
                class="pointer-events-none absolute left-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-primary/30"
                :style="{ width: `${ bufferedPercent }%` }"
            />
            <div
                class="pointer-events-none absolute left-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-primary"
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

        <div class="flex items-center gap-1">
            <UButton
                icon="i-lucide-shuffle"
                :color="shuffle ? 'primary' : 'neutral'"
                variant="ghost"
                size="sm"
                :aria-label="shuffle ? 'Shuffle on' : 'Shuffle off'"
                @click="emit('toggle-shuffle')"
            />
            <UButton
                icon="i-lucide-skip-back"
                color="neutral"
                variant="ghost"
                size="sm"
                :disabled="!hasPrevious"
                aria-label="Previous track"
                @click="emit('previous')"
            />
            <UButton
                :icon="playing ? 'i-lucide-pause' : 'i-lucide-play'"
                color="neutral"
                variant="ghost"
                size="sm"
                :aria-label="playing ? 'Pause' : 'Play'"
                @click="emit('toggle-play')"
            />
            <UButton
                icon="i-lucide-skip-forward"
                color="neutral"
                variant="ghost"
                size="sm"
                :disabled="!hasNext"
                aria-label="Next track"
                @click="emit('next')"
            />
            <UButton
                :icon="repeat === 'one' ? 'i-lucide-repeat-1' : 'i-lucide-repeat'"
                :color="repeat === 'off' ? 'neutral' : 'primary'"
                variant="ghost"
                size="sm"
                :aria-label="`Repeat ${ repeat }`"
                @click="emit('cycle-repeat')"
            />

            <span class="ml-1 text-xs tabular-nums text-dimmed">
                {{ formatMediaTime(currentTime) }} / {{ formatMediaTime(duration) }}
            </span>

            <div class="ml-auto flex items-center gap-1">
                <UButton
                    v-if="castAvailable"
                    icon="i-lucide-cast"
                    :color="casting ? 'primary' : 'neutral'"
                    variant="ghost"
                    size="sm"
                    :aria-label="casting ? 'Casting' : 'Cast'"
                    @click="emit('cast')"
                />
                <UButton
                    :icon="volumeIcon"
                    color="neutral"
                    variant="ghost"
                    size="sm"
                    :aria-label="muted || volume === 0 ? 'Unmute' : 'Mute'"
                    @click="emit('toggle-mute')"
                />

                <div
                    class="relative flex h-4 w-16 items-center rounded-full has-[:focus-visible]:outline-2
                        has-[:focus-visible]:outline-primary has-[:focus-visible]:outline-offset-2"
                >
                    <div
                        class="pointer-events-none absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded-full
                            bg-accented"
                    />
                    <div
                        class="pointer-events-none absolute left-0 top-1/2 h-1 -translate-y-1/2 rounded-full
                            bg-primary"
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
                        aria-label="Playback speed"
                    />
                </UDropdownMenu>
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
