//----------------------------------------------------------------------------------------------------------------------
// Media Element Binding
//
// The element persists across track changes, so the browser's media session, fullscreen, and any remote-playback
// session carry through queue advances. It watches [src, playToken]: a new src reloads the element, while a playToken
// bump with the same src restarts it (repeat-one, an explicit replay). Volume, mute, and rate persist on the element;
// the initial values matter only on first mount, and later changes are still reported so the host can seed a remount
// when playback switches between audio and video.
//----------------------------------------------------------------------------------------------------------------------

import { type Ref, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useToast } from '@nuxt/ui/composables';

// Engines
import { bufferedPercent, clampSeekTime, sameMediaSource } from '../../../engines/media/playback.ts';
import { resolveMediaShortcut } from '../../../engines/media/keyboard.ts';

//----------------------------------------------------------------------------------------------------------------------

// The player props the element follows. A component passes its own reactive props object.
export interface MediaElementSource
{
    src : string;
    playToken : number;
    autoplay : boolean;
    initialVolume : number;
    initialMuted : boolean;
    initialRate : number;
}

export interface MediaElementEvents
{
    error : () => void;
    ended : () => void;
    castStart : () => void;
    volumeChange : (volume : number, muted : boolean) => void;
    rateChange : (rate : number) => void;
}

export interface MediaElementBinding
{
    playing : Ref<boolean>;
    currentTime : Ref<number>;
    duration : Ref<number>;
    bufferedPercent : Ref<number>;
    volume : Ref<number>;
    muted : Ref<boolean>;
    playbackRate : Ref<number>;
    errored : Ref<boolean>;
    castAvailable : Ref<boolean>;
    casting : Ref<boolean>;

    togglePlay : () => void;
    seek : (time : number) => void;
    seekBy : (deltaSeconds : number) => void;
    setVolume : (next : number) => void;
    adjustVolume : (delta : number) => void;
    toggleMute : () => void;
    setRate : (rate : number) => void;
    promptCast : () => void;
    onKeydown : (event : KeyboardEvent) => void;
}

//----------------------------------------------------------------------------------------------------------------------

// A blocked autoplay rejects the promise; the paused state is left alone since the pause event never fires.
function ignoreBlockedAutoplay() : void { /* no-op */ }

//----------------------------------------------------------------------------------------------------------------------

export function useMediaElement(
    mediaEl : Ref<HTMLMediaElement | null>,
    source : MediaElementSource,
    events : MediaElementEvents
) : MediaElementBinding
{
    const toast = useToast();

    const playing = ref(false);
    const currentTime = ref(0);
    const duration = ref(0);
    const buffered = ref(0);
    const volume = ref(1);
    const muted = ref(false);
    const playbackRate = ref(1);
    const errored = ref(false);

    // Where a cast handoff has to put the listener back. Taking the playback token rewrites the src of the
    // track already playing, so the element reloads onto the same media -- and a reload starts at zero.
    let resumeAt : number | null = null;

    //------------------------------------------------------------------------------------------------------------------
    // Native element events -- the source of truth for state a user action doesn't already know synchronously.
    //------------------------------------------------------------------------------------------------------------------

    function onPlay() : void { playing.value = true; }
    function onPause() : void { playing.value = false; }

    function onError() : void
    {
        errored.value = true;
        events.error();
    }

    function onEnded() : void
    {
        playing.value = false;
        events.ended();
    }

    function onTimeUpdate() : void
    {
        if(mediaEl.value === null) { return; }

        currentTime.value = mediaEl.value.currentTime;
    }

    function onProgress() : void
    {
        if(mediaEl.value === null) { return; }

        buffered.value = bufferedPercent(mediaEl.value.buffered, duration.value);
    }

    function onLoadedMetadata() : void
    {
        if(mediaEl.value === null) { return; }

        duration.value = mediaEl.value.duration;

        // Applied once the element knows how long the media is; before that a seek has nothing to seek within.
        if(resumeAt !== null)
        {
            mediaEl.value.currentTime = resumeAt;
            resumeAt = null;
        }
    }

    function onVolumeChange() : void
    {
        if(mediaEl.value === null) { return; }

        volume.value = mediaEl.value.volume;
        muted.value = mediaEl.value.muted;
        events.volumeChange(volume.value, muted.value);
    }

    function onRateChange() : void
    {
        if(mediaEl.value === null) { return; }

        playbackRate.value = mediaEl.value.playbackRate;
        events.rateChange(playbackRate.value);
    }

    const listeners : readonly [ keyof HTMLMediaElementEventMap, () => void ][] = [
        [ 'play', onPlay ],
        [ 'pause', onPause ],
        [ 'ended', onEnded ],
        [ 'timeupdate', onTimeUpdate ],
        [ 'progress', onProgress ],
        [ 'loadedmetadata', onLoadedMetadata ],
        [ 'durationchange', onLoadedMetadata ],
        [ 'volumechange', onVolumeChange ],
        [ 'ratechange', onRateChange ],
        [ 'error', onError ],
    ];

    //------------------------------------------------------------------------------------------------------------------
    // Transport actions -- applied to the element and reflected optimistically, since the browser applies these
    // properties synchronously even though its confirming event (volumechange, ratechange) queues asynchronously.
    //------------------------------------------------------------------------------------------------------------------

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

    // Bound on the player's own focusable container rather than the window, so the shortcuts never compete with
    // shortcuts elsewhere on the page.
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
    // Casting -- the standard Remote Playback API: Chromecast in Chromium, AirPlay in Safari, nothing in Firefox (whose
    // elements carry no remote, so the button never appears). The button gates on watchAvailability. For video,
    // Chrome's monitoring answers truthfully once the media is loaded, and it stays false through every case prompt()
    // would otherwise swallow into a fake "dismissed" (metadata not yet loaded, media under Chrome's 15-second remoting
    // floor, no allowlisted device). For audio, Chromium's Cast sink filter requires a video codec, so its monitoring
    // reports false for an audio-only source and only Safari's AirPlay (HomePods, AirPlay speakers) lights the button.
    // Where monitoring itself is unsupported, the button shows and prompt()'s native picker does the discovery -- the
    // spec's own degraded mode.
    //------------------------------------------------------------------------------------------------------------------

    const castAvailable = ref(false);
    const casting = ref(false);
    let castWatchID : number | null = null;

    function remoteOf() : RemotePlayback | undefined
    {
        return mediaEl.value?.remote;
    }

    // Both `connecting` and `connect` land here: the sooner the host mints, the sooner the receiver is handed a URL
    // it can actually fetch, and asking twice costs nothing.
    function onRemoteConnect() : void
    {
        casting.value = true;
        events.castStart();
    }
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
        if(casting.value) { events.castStart(); }
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
    // Track lifecycle
    //------------------------------------------------------------------------------------------------------------------

    // First mount seeds the listener's settings and honours a queue-driven start; later tracks arrive through the
    // watcher below on the same living element.
    onMounted(() =>
    {
        const element = mediaEl.value;
        if(element === null) { return; }

        for(const [ type, listener ] of listeners) { element.addEventListener(type, listener); }

        element.volume = source.initialVolume;
        element.muted = source.initialMuted;
        element.playbackRate = source.initialRate;
        volume.value = source.initialVolume;
        muted.value = source.initialMuted;
        playbackRate.value = source.initialRate;

        watchCast();

        if(source.autoplay) { element.play().catch(ignoreBlockedAutoplay); }
    });

    // A src change reloads the living element (post-flush, so the DOM carries the new src before load() adopts it); a
    // playToken bump with the same src restarts it. Per-track state resets either way -- including errored, so one
    // failed track does not poison the next.
    watch([ () => source.src, () => source.playToken ], ([ nextSrc ], [ previousSrc ]) =>
    {
        if(mediaEl.value === null) { return; }

        // Same media under a different URL is the playback token arriving for a receiver, not a new track. The
        // element still has to reload onto it, so the position and whether it was playing ride across -- pressing
        // the cast button should hand the track over, not start it again.
        const carried = nextSrc !== previousSrc && sameMediaSource(nextSrc, previousSrc)
            ? { at: currentTime.value, playing: playing.value }
            : null;

        errored.value = false;
        playing.value = false;
        currentTime.value = 0;
        duration.value = 0;
        buffered.value = 0;

        if(nextSrc !== previousSrc)
        {
            resumeAt = carried === null ? null : carried.at;
            mediaEl.value.load();
        }
        else { mediaEl.value.currentTime = 0; }

        if(source.autoplay || carried?.playing === true) { mediaEl.value.play().catch(ignoreBlockedAutoplay); }
    }, { flush: 'post' });

    // A detached element can hold its network request open in some browsers; stopping playback and reloading an
    // emptied element on the way out aborts the fetch.
    onBeforeUnmount(() =>
    {
        unwatchCast();

        const element = mediaEl.value;
        if(element === null) { return; }

        for(const [ type, listener ] of listeners) { element.removeEventListener(type, listener); }

        element.pause();
        element.removeAttribute('src');
        element.load();
    });

    return {
        playing,
        currentTime,
        duration,
        bufferedPercent: buffered,
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
    };
}

//----------------------------------------------------------------------------------------------------------------------
