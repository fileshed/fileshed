<!----------------------------------------------------------------------------------------------------------------------
  -- Video Player
  --
  -- Mount contract: pass nodeID, name, and mimeType for the file to play -- the already-resolved facts a host reads
  -- off the node, mirroring how filePage.vue hands the text editor an already-loaded value rather than an id to
  -- fetch. There is no v-model and nothing is emitted: this is a viewer with no save path, and an unplayable file
  -- shows its own in-card fallback rather than asking the host to react. The component fills whatever size its host
  -- gives it and cards itself (rounded, bordered, clipped) so it reads as complete standing alone.
  --
  -- The src is the node's inline-download URL, not fetched bytes: the browser streams it directly against the
  -- Range-supporting download endpoint, so scrubbing never waits on the whole file.
  --------------------------------------------------------------------------------------------------------------------->

<template>
    <div
        ref="container"
        tabindex="0"
        class="relative flex h-full w-full flex-col overflow-hidden rounded-lg border border-default bg-black
            outline-none"
        @keydown="onKeydown"
    >
        <template v-if="!errored">
            <video
                ref="mediaEl"
                class="min-h-0 flex-1 bg-black"
                preload="metadata"
                playsinline
                :aria-label="name"
                @click="togglePlay"
                @dblclick="toggleFullscreen"
                @play="onPlay"
                @pause="onPause"
                @ended="onEnded"
                @timeupdate="onTimeUpdate"
                @progress="onProgress"
                @loadedmetadata="onLoadedMetadata"
                @durationchange="onLoadedMetadata"
                @volumechange="onVolumeChange"
                @ratechange="onRateChange"
                @error="onError"
            >
                <source :src="src" :type="mimeType">
            </video>

            <VideoControls
                class="absolute inset-x-0 bottom-0"
                :playing="playing"
                :current-time="currentTime"
                :duration="duration"
                :buffered-percent="bufferedPercentValue"
                :volume="volume"
                :muted="muted"
                :playback-rate="playbackRate"
                :is-fullscreen="isFullscreen"
                @toggle-play="togglePlay"
                @seek="seek"
                @toggle-mute="toggleMute"
                @set-volume="setVolume"
                @cycle-rate="cycleRate"
                @toggle-fullscreen="toggleFullscreen"
            />
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
    import { computed, onBeforeUnmount, onMounted, ref } from 'vue';

    // Resource Access
    import { downloadUrl } from '../../../resource-access/downloads.ts';

    // Engines
    import { bufferedPercent, clampSeekTime, nextPlaybackRate } from '../../../engines/media/playback.ts';
    import { resolveMediaShortcut } from '../../../engines/media/keyboard.ts';

    // Components
    import VideoControls from './videoControls.vue';

    //------------------------------------------------------------------------------------------------------------------

    const props = defineProps<{
        nodeID : string;
        name : string;
        mimeType : string;
    }>();

    const src = computed(() => downloadUrl(props.nodeID, 'inline'));
    const downloadHref = computed(() => downloadUrl(props.nodeID));

    //------------------------------------------------------------------------------------------------------------------

    const container = ref<HTMLElement | null>(null);
    const mediaEl = ref<HTMLVideoElement | null>(null);

    const playing = ref(false);
    const currentTime = ref(0);
    const duration = ref(0);
    const bufferedPercentValue = ref(0);
    const volume = ref(1);
    const muted = ref(false);
    const playbackRate = ref(1);
    const isFullscreen = ref(false);
    const errored = ref(false);

    //------------------------------------------------------------------------------------------------------------------
    // Native element events -- the source of truth for state a user action doesn't already know synchronously.
    //------------------------------------------------------------------------------------------------------------------

    function onPlay() : void { playing.value = true; }
    function onPause() : void { playing.value = false; }
    function onEnded() : void { playing.value = false; }
    function onError() : void { errored.value = true; }

    function onTimeUpdate() : void
    {
        if(mediaEl.value === null) { return; }

        currentTime.value = mediaEl.value.currentTime;
    }

    function onProgress() : void
    {
        if(mediaEl.value === null) { return; }

        bufferedPercentValue.value = bufferedPercent(mediaEl.value.buffered, duration.value);
    }

    function onLoadedMetadata() : void
    {
        if(mediaEl.value === null) { return; }

        duration.value = mediaEl.value.duration;
    }

    function onVolumeChange() : void
    {
        if(mediaEl.value === null) { return; }

        volume.value = mediaEl.value.volume;
        muted.value = mediaEl.value.muted;
    }

    function onRateChange() : void
    {
        if(mediaEl.value === null) { return; }

        playbackRate.value = mediaEl.value.playbackRate;
    }

    //------------------------------------------------------------------------------------------------------------------
    // Transport actions -- applied to the element and reflected optimistically, since the browser applies these
    // properties synchronously even though its confirming event (volumechange, ratechange) queues asynchronously.
    //------------------------------------------------------------------------------------------------------------------

    // A blocked autoplay rejects the promise; the paused state is left alone since the pause event never fires.
    function ignoreBlockedAutoplay() : void { /* no-op */ }

    // Driven off our own playing ref -- the element's own .paused only updates once the browser confirms play()/
    // pause() actually took effect, and that confirmation is exactly what playing already tracks via the events.
    function togglePlay() : void
    {
        if(mediaEl.value === null || errored.value) { return; }

        if(playing.value) { mediaEl.value.pause(); }
        else { mediaEl.value.play().catch(ignoreBlockedAutoplay); }
    }

    function seek(time : number) : void
    {
        if(mediaEl.value === null) { return; }

        const clamped = clampSeekTime(time, duration.value);
        mediaEl.value.currentTime = clamped;
        currentTime.value = clamped;
    }

    function seekBy(deltaSeconds : number) : void
    {
        seek(currentTime.value + deltaSeconds);
    }

    function setVolume(next : number) : void
    {
        if(mediaEl.value === null) { return; }

        const clamped = Math.min(1, Math.max(0, next));
        mediaEl.value.volume = clamped;
        volume.value = clamped;

        if(clamped > 0 && muted.value)
        {
            mediaEl.value.muted = false;
            muted.value = false;
        }
    }

    function adjustVolume(delta : number) : void
    {
        setVolume(volume.value + delta);
    }

    function toggleMute() : void
    {
        if(mediaEl.value === null) { return; }

        const next = !muted.value;
        mediaEl.value.muted = next;
        muted.value = next;
    }

    function cycleRate() : void
    {
        if(mediaEl.value === null) { return; }

        const next = nextPlaybackRate(playbackRate.value);
        mediaEl.value.playbackRate = next;
        playbackRate.value = next;
    }

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

    //------------------------------------------------------------------------------------------------------------------
    // Keyboard shortcuts -- scoped to the player itself (a focusable container) rather than the window, so they never
    // compete with shortcuts elsewhere on the page.
    //------------------------------------------------------------------------------------------------------------------

    function onKeydown(event : KeyboardEvent) : void
    {
        const shortcut = resolveMediaShortcut(event.key);
        if(shortcut === null) { return; }

        event.preventDefault();

        if(shortcut.type === 'toggle-play') { togglePlay(); }
        else if(shortcut.type === 'seek') { seekBy(shortcut.deltaSeconds); }
        else { adjustVolume(shortcut.delta); }
    }

    //------------------------------------------------------------------------------------------------------------------

    onMounted(() => { document.addEventListener('fullscreenchange', onFullscreenChange); });
    onBeforeUnmount(() => { document.removeEventListener('fullscreenchange', onFullscreenChange); });
</script>

<!--------------------------------------------------------------------------------------------------------------------->
