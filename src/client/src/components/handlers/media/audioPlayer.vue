<!----------------------------------------------------------------------------------------------------------------------
  -- Audio Player
  --
  -- The src is the node's inline-download URL, not fetched bytes: the browser streams it against the Range-supporting
  -- download endpoint, so scrubbing never waits on the whole file.
  --------------------------------------------------------------------------------------------------------------------->

<template>
    <div
        tabindex="0"
        class="flex w-full max-w-md flex-col gap-3 rounded-lg border border-default bg-elevated p-4 outline-none"
        @keydown="onKeydown"
    >
        <audio ref="mediaEl" class="hidden" preload="auto" :src="src" />

        <MediaControls
            v-if="!errored"
            variant="card"
            :playing="playing"
            :current-time="currentTime"
            :duration="duration"
            :buffered-percent="bufferedPercent"
            :volume="volume"
            :muted="muted"
            :playback-rate="playbackRate"
            :has-previous="hasPrevious"
            :has-next="hasNext"
            :shuffle="shuffle"
            :repeat="repeat"
            :cast-available="castAvailable"
            :casting="casting"
            @toggle-play="togglePlay"
            @seek="seek"
            @toggle-mute="toggleMute"
            @set-volume="setVolume"
            @set-rate="setRate"
            @previous="emit('previous')"
            @next="emit('next')"
            @toggle-shuffle="emit('toggle-shuffle')"
            @cycle-repeat="emit('cycle-repeat')"
            @cast="promptCast"
        />

        <div v-else class="flex flex-col items-center gap-2 py-1 text-center">
            <UIcon name="i-lucide-triangle-alert" class="size-6 text-dimmed" />
            <p class="text-sm text-muted">
                Can't be played here.
            </p>
            <UButton
                icon="i-lucide-download"
                label="Download"
                color="neutral"
                variant="subtle"
                size="sm"
                :href="downloadHref"
                :download="name"
            />
        </div>
    </div>
</template>

<!--------------------------------------------------------------------------------------------------------------------->

<script setup lang="ts">
    import { ref } from 'vue';

    // Engines
    import type { RepeatMode } from '../../../engines/media/queue.ts';

    // Components
    import MediaControls from './mediaControls.vue';
    import { useMediaElement } from './mediaElement.ts';

    //------------------------------------------------------------------------------------------------------------------

    const props = defineProps<{
        src : string;
        downloadHref : string;
        name : string;
        playToken : number;
        hasPrevious : boolean;
        hasNext : boolean;
        shuffle : boolean;
        repeat : RepeatMode;
        autoplay : boolean;
        initialVolume : number;
        initialMuted : boolean;
        initialRate : number;
    }>();

    const emit = defineEmits<{
        'ended' : [];
        'error' : [];
        'previous' : [];
        'next' : [];
        'toggle-shuffle' : [];
        'cycle-repeat' : [];
        'cast-start' : [];
        'volume-change' : [ volume : number, muted : boolean ];
        'rate-change' : [ rate : number ];
    }>();

    //------------------------------------------------------------------------------------------------------------------

    const mediaEl = ref<HTMLAudioElement | null>(null);

    const {
        playing,
        currentTime,
        duration,
        bufferedPercent,
        volume,
        muted,
        playbackRate,
        errored,
        castAvailable,
        casting,
        togglePlay,
        seek,
        seekBy,
        setVolume,
        adjustVolume,
        toggleMute,
        setRate,
        promptCast,
        onKeydown,
    } = useMediaElement(mediaEl, props, {
        error: () => emit('error'),
        ended: () => emit('ended'),
        castStart: () => emit('cast-start'),
        volumeChange: (nextVolume, nextMuted) => emit('volume-change', nextVolume, nextMuted),
        rateChange: (rate) => emit('rate-change', rate),
    });

    defineExpose({ togglePlay, seekBy, adjustVolume });
</script>

<!--------------------------------------------------------------------------------------------------------------------->
