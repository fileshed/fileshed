<!----------------------------------------------------------------------------------------------------------------------
  -- Video Player
  --
  -- Mount contract: pass the already-resolved facts of the track to play -- the src the element streams (a drive
  -- inline-download URL or a remote stream), the download fallback href, and name -- plus the queue context:
  -- whether neighbours exist for the transport's previous/next, whether an arriving track should start on its own,
  -- and the volume/mute/rate the listener chose before this player existed. The player PERSISTS across track
  -- changes -- the element survives queue advances, which is what lets fullscreen and a cast/AirPlay session ride
  -- through track boundaries -- watching [src, playToken]: a new src reloads the living element, a playToken bump
  -- with the same src restarts it. The element outlives even an unplayable track (hidden behind the in-card
  -- fallback, never unmounted), so the next arrival recovers it. The component fills whatever size its host gives
  -- it and cards itself (rounded, bordered, clipped) so it reads as complete standing alone.
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
        />

        <template v-if="!errored">
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
                :has-previous="hasPrevious"
                :has-next="hasNext"
                :shuffle="shuffle"
                :repeat="repeat"
                :cast-available="castAvailable"
                :casting="casting"
                :playlist-hidden="playlistHidden"
                @toggle-play="togglePlay"
                @seek="seek"
                @toggle-mute="toggleMute"
                @set-volume="setVolume"
                @set-rate="setRate"
                @toggle-fullscreen="toggleFullscreen"
                @previous="emit('previous')"
                @next="emit('next')"
                @toggle-shuffle="emit('toggle-shuffle')"
                @cycle-repeat="emit('cycle-repeat')"
                @cast="promptCast"
                @toggle-playlist="emit('toggle-playlist')"
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
    import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
    import { useToast } from '@nuxt/ui/composables';

    // Engines
    import { bufferedPercent, clampSeekTime } from '../../../engines/media/playback.ts';
    import { resolveMediaShortcut } from '../../../engines/media/keyboard.ts';
    import type { RepeatMode } from '../../../engines/media/queue.ts';

    // Components
    import VideoControls from './videoControls.vue';

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
        'toggle-playlist' : [];
        'volume-change' : [ volume : number, muted : boolean ];
        'rate-change' : [ rate : number ];
    }>();

    //------------------------------------------------------------------------------------------------------------------

    const toast = useToast();

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

    function onError() : void
    {
        errored.value = true;
        emit('error');
    }

    function onEnded() : void
    {
        playing.value = false;
        emit('ended');
    }

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
        emit('volume-change', volume.value, muted.value);
    }

    function onRateChange() : void
    {
        if(mediaEl.value === null) { return; }

        playbackRate.value = mediaEl.value.playbackRate;
        emit('rate-change', playbackRate.value);
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

    function setRate(rate : number) : void
    {
        if(mediaEl.value === null) { return; }

        mediaEl.value.playbackRate = rate;
        playbackRate.value = rate;
    }

    //------------------------------------------------------------------------------------------------------------------
    // Casting -- the standard Remote Playback API: Chromecast in Chromium, AirPlay in Safari, nothing in Firefox
    // (whose elements carry no remote, so the button simply never appears). The button gates on watchAvailability:
    // for VIDEO sources Chrome's monitoring answers truthfully once the media is loaded, and it stays false through
    // every case prompt() would otherwise swallow into a fake "dismissed" (metadata not yet loaded, media under
    // Chrome's 15-second remoting floor, no allowlisted device). Where monitoring itself is unsupported, the button
    // shows and prompt()'s native picker does the discovery -- the spec's own degraded mode.
    //------------------------------------------------------------------------------------------------------------------

    const castAvailable = ref(false);
    const casting = ref(false);
    let castWatchID : number | null = null;

    function remoteOf() : RemotePlayback | undefined
    {
        return mediaEl.value?.remote;
    }

    function onRemoteConnect() : void { casting.value = true; }
    function onRemoteDisconnect() : void { casting.value = false; }

    // Closing the picker arrives as NotAllowedError -- a choice, not a failure. Anything else names its reason in
    // a toast, because a cast button that silently does nothing is indistinguishable from a broken one.
    function promptCast() : void
    {
        const remote = remoteOf();
        if(remote === undefined) { return; }

        remote.prompt()
            .catch((caught : unknown) =>
            {
                if(caught instanceof DOMException && caught.name === 'NotAllowedError') { return; }

                const detail = caught instanceof DOMException && caught.name === 'NotFoundError'
                    ? 'No cast devices were found on the network.'
                    : (caught instanceof Error ? caught.message : 'Casting failed.');

                toast.add({ title: 'Couldn\'t start casting', description: detail, color: 'error' });
            });
    }

    function watchCast() : void
    {
        const remote = remoteOf();
        if(remote === undefined || typeof remote.watchAvailability !== 'function') { return; }

        casting.value = remote.state !== 'disconnected';
        remote.addEventListener('connect', onRemoteConnect);
        remote.addEventListener('connecting', onRemoteConnect);
        remote.addEventListener('disconnect', onRemoteDisconnect);

        remote.watchAvailability((available) => { castAvailable.value = available; })
            .then((id) => { castWatchID = id; })
            .catch(() => { castAvailable.value = true; });
    }

    function unwatchCast() : void
    {
        const remote = remoteOf();
        if(remote === undefined) { return; }

        remote.removeEventListener('connect', onRemoteConnect);
        remote.removeEventListener('connecting', onRemoteConnect);
        remote.removeEventListener('disconnect', onRemoteDisconnect);

        if(castWatchID !== null)
        {
            void remote.cancelWatchAvailability(castWatchID)
                .catch(() => undefined);
        }
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

    onMounted(() =>
    {
        document.addEventListener('fullscreenchange', onFullscreenChange);

        // First mount seeds the listener's settings and honours a queue-driven start; later tracks arrive through
        // the watcher below on the same living element.
        if(mediaEl.value !== null)
        {
            mediaEl.value.volume = props.initialVolume;
            mediaEl.value.muted = props.initialMuted;
            mediaEl.value.playbackRate = props.initialRate;
            volume.value = props.initialVolume;
            muted.value = props.initialMuted;
            playbackRate.value = props.initialRate;

            watchCast();

            if(props.autoplay) { mediaEl.value.play().catch(ignoreBlockedAutoplay); }
        }
    });

    // A src change reloads the living element (post-flush, so the DOM carries the new src before load() adopts
    // it); a playToken bump with the same src restarts it. Per-track state resets either way -- including errored,
    // so one failed track does not poison the next.
    watch([ () => props.src, () => props.playToken ], ([ nextSrc ], [ previousSrc ]) =>
    {
        if(mediaEl.value === null) { return; }

        errored.value = false;
        playing.value = false;
        currentTime.value = 0;
        duration.value = 0;
        bufferedPercentValue.value = 0;

        if(nextSrc !== previousSrc) { mediaEl.value.load(); }
        else { mediaEl.value.currentTime = 0; }

        if(props.autoplay) { mediaEl.value.play().catch(ignoreBlockedAutoplay); }
    }, { flush: 'post' });

    // A detached element can hold its network request open in some browsers; stopping playback and reloading an
    // emptied element on the way out aborts the fetch.
    onBeforeUnmount(() =>
    {
        document.removeEventListener('fullscreenchange', onFullscreenChange);
        unwatchCast();

        if(mediaEl.value === null) { return; }

        mediaEl.value.pause();
        mediaEl.value.removeAttribute('src');
        mediaEl.value.load();
    });

    defineExpose({ togglePlay, seekBy, adjustVolume });
</script>

<!--------------------------------------------------------------------------------------------------------------------->
