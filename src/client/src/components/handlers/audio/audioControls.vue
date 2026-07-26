<!----------------------------------------------------------------------------------------------------------------------
  -- Audio Controls
  --
  -- The transport row inside the compact audio card: play/pause, a scrub bar showing playback progress and how far
  -- the browser has buffered ahead, elapsed/total time, volume, and playback rate -- the same transport the video
  -- family exposes, minus fullscreen, which has no meaning without a visual surface. Presentational only -- it holds
  -- no media state of its own, reading everything from props and asking the player to act via emits. Styled with the
  -- app's own semantic tokens rather than a fixed dark bar, since it sits in the normal surface, not over a video
  -- image.
  --------------------------------------------------------------------------------------------------------------------->

<template>
    <div class="flex flex-col gap-1.5">
        <div
            class="relative flex h-4 w-full items-center rounded-full has-[:focus-visible]:outline-2
                has-[:focus-visible]:outline-primary has-[:focus-visible]:outline-offset-2"
        >
            <div class="pointer-events-none absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-muted" />
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

        <div class="flex items-center gap-2">
            <UButton
                :icon="playing ? 'i-lucide-pause' : 'i-lucide-play'"
                color="neutral"
                variant="subtle"
                size="sm"
                :aria-label="playing ? 'Pause' : 'Play'"
                @click="emit('toggle-play')"
            />

            <span class="text-xs tabular-nums text-dimmed">
                {{ formatMediaTime(currentTime) }} / {{ formatMediaTime(duration) }}
            </span>

            <div class="ml-auto flex items-center gap-1">
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
                            bg-muted"
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

                <UButton
                    :label="`${ playbackRate }x`"
                    color="neutral"
                    variant="ghost"
                    size="sm"
                    aria-label="Playback speed"
                    @click="emit('cycle-rate')"
                />
            </div>
        </div>
    </div>
</template>

<!--------------------------------------------------------------------------------------------------------------------->

<script setup lang="ts">
    import { computed } from 'vue';

    // Engines
    import { formatMediaTime } from '../../../engines/media/playback.ts';

    //------------------------------------------------------------------------------------------------------------------

    const props = defineProps<{
        playing : boolean;
        currentTime : number;
        duration : number;
        bufferedPercent : number;
        volume : number;
        muted : boolean;
        playbackRate : number;
    }>();

    const emit = defineEmits<{
        'toggle-play' : [];
        'seek' : [ time : number ];
        'toggle-mute' : [];
        'set-volume' : [ value : number ];
        'cycle-rate' : [];
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
