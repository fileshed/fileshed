<!----------------------------------------------------------------------------------------------------------------------
  -- Video Player
  --
  -- The element outlives even an unplayable track (hidden behind the fallback, never unmounted), so the next track
  -- recovers it.
  --
  -- The src is the node's inline-download URL, not fetched bytes: the browser streams it against the Range-supporting
  -- download endpoint, so scrubbing never waits on the whole file.
  --------------------------------------------------------------------------------------------------------------------->

<template>
    <div
        ref="container"
        tabindex="0"
        class="relative flex h-full w-full flex-col overflow-hidden rounded-lg border border-default bg-black
            outline-none"
        @keydown="onKeydown"
    >
        <video
            v-show="!errored"
            ref="mediaEl"
            class="min-h-0 flex-1 bg-black"
            preload="auto"
            playsinline
            :src="src"
            :aria-label="name"
            @click="togglePlay"
            @dblclick="toggleFullscreen"
        />

        <template v-if="!errored">
            <MediaControls
                class="absolute inset-x-0 bottom-0"
                variant="overlay"
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
            >
                <template #trailing>
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
                        @click="toggleFullscreen"
                    />
                </template>
            </MediaControls>
        </template>

        <div v-else class="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
            <UIcon name="i-lucide-triangle-alert" class="size-8 text-neutral-400" />
            <p class="text-sm text-neutral-300">
                {{ name }} can't be played here.
            </p>
            <UButton
                icon="i-lucide-download"
                label="Download"
                color="neutral"
                variant="subtle"
                :href="downloadHref"
                :download="name"
            />
        </div>
    </div>
</template>

<!--------------------------------------------------------------------------------------------------------------------->

<script setup lang="ts">
    import { onBeforeUnmount, onMounted, ref } from 'vue';

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
        playlistHidden : boolean;
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
        'toggle-playlist' : [];
        'volume-change' : [ volume : number, muted : boolean ];
        'rate-change' : [ rate : number ];
    }>();

    //------------------------------------------------------------------------------------------------------------------

    const container = ref<HTMLElement | null>(null);
    const mediaEl = ref<HTMLVideoElement | null>(null);
    const isFullscreen = ref(false);

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

    //------------------------------------------------------------------------------------------------------------------
    // Fullscreen -- guarded for browsers (and test environments) with no Fullscreen API at all.
    //------------------------------------------------------------------------------------------------------------------

    function toggleFullscreen() : void
    {
        if(container.value === null) { return; }

        if(document.fullscreenElement !== null && typeof document.exitFullscreen === 'function')
        {
            void document.exitFullscreen();
            return;
        }

        if(typeof container.value.requestFullscreen === 'function') { void container.value.requestFullscreen(); }
    }

    function onFullscreenChange() : void
    {
        isFullscreen.value = document.fullscreenElement === container.value;
    }

    onMounted(() =>
    {
        document.addEventListener('fullscreenchange', onFullscreenChange);
    });

    onBeforeUnmount(() =>
    {
        document.removeEventListener('fullscreenchange', onFullscreenChange);
    });

    defineExpose({ togglePlay, seekBy, adjustVolume });
</script>

<!--------------------------------------------------------------------------------------------------------------------->
