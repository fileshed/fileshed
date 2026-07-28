<!----------------------------------------------------------------------------------------------------------------------
  -- Media Player
  --
  -- The media family's host: the playing surface (video canvas, or the compact audio card centered where a canvas
  -- would be) beside the playlist, under an identity header that follows the queue. It owns the playlist session --
  -- opening the routed file into the store on mount, resetting on leave. Players PERSIST across track changes --
  -- src and playToken flow as reactive props into a living element, so fullscreen and cast sessions survive queue
  -- advances; only crossing between audio and video swaps the surface (an element type change cannot survive
  -- anyway). Volume, mute, and rate live on the persistent element and are caught here only to seed a cross-kind
  -- remount. A queue-driven arrival starts playing on its own, and a track the browser can't decode is skipped
  -- rather than stalling the queue.
  --------------------------------------------------------------------------------------------------------------------->

<template>
    <div class="flex h-full flex-col">
        <MediaIdentityBar />

        <div class="flex min-h-0 flex-1 flex-col gap-4 p-4 sm:p-6 lg:flex-row">
            <div
                class="flex min-h-0 min-w-0 flex-col"
                :class="store.track?.kind === 'audio' ? 'shrink-0 lg:flex-1' : 'flex-1'"
            >
                <VideoPlayer
                    v-if="store.track !== null && !store.track.broken && store.track.kind === 'video'"
                    ref="player"
                    v-bind="{
                        src: srcFor(store.track),
                        downloadHref: downloadHrefFor(store.track),
                        name: store.track.name,
                        playToken: store.playToken,
                    }"
                    :has-previous="store.hasPrevious"
                    :has-next="store.hasNext"
                    :shuffle="store.shuffle"
                    :repeat="store.repeat"
                    :playlist-hidden="playlistHidden"
                    :autoplay="store.autoplay"
                    :initial-volume="volume"
                    :initial-muted="muted"
                    :initial-rate="rate"
                    class="min-h-0 flex-1"
                    @ended="store.advance()"
                    @error="store.handleTrackError()"
                    @previous="store.previous()"
                    @next="store.next()"
                    @toggle-shuffle="store.toggleShuffle()"
                    @cycle-repeat="store.cycleRepeat()"
                    @toggle-playlist="playlistHidden = !playlistHidden"
                    @volume-change="onVolumeChange"
                    @rate-change="onRateChange"
                />

                <div
                    v-else-if="store.track !== null && store.track.broken"
                    class="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 rounded-lg border
                        border-dashed border-default p-6 text-center"
                >
                    <UIcon name="i-lucide-file-question" class="size-8 text-dimmed" />
                    <p class="max-w-full truncate text-sm font-medium">
                        {{ store.track.name }}
                    </p>
                    <p class="text-sm text-muted">
                        This playlist entry couldn't be resolved.
                    </p>
                </div>

                <div v-else-if="store.track !== null" class="flex min-h-0 flex-1 items-center justify-center">
                    <div class="flex w-full max-w-md flex-col items-center gap-5">
                        <img
                            v-if="currentTags?.artworkUrl"
                            :src="currentTags.artworkUrl"
                            alt=""
                            class="size-48 rounded-lg object-cover shadow-lg"
                        >
                        <div
                            v-else
                            class="flex size-48 items-center justify-center rounded-lg border border-default
                                bg-elevated"
                        >
                            <UIcon name="i-lucide-music" class="size-16 text-dimmed" />
                        </div>

                        <div class="flex w-full flex-col items-center gap-0.5 text-center">
                            <p class="max-w-full truncate font-medium">
                                {{ currentTags?.title ?? store.track.name }}
                            </p>
                            <p v-if="currentTags?.artist" class="max-w-full truncate text-sm text-muted">
                                {{ currentTags.artist }}
                            </p>
                            <p v-if="currentTags?.album" class="max-w-full truncate text-xs text-dimmed">
                                {{ currentTags.album }}
                            </p>
                        </div>

                        <AudioPlayer
                            ref="player"
                            v-bind="{
                                src: srcFor(store.track),
                                downloadHref: downloadHrefFor(store.track),
                                name: store.track.name,
                                playToken: store.playToken,
                            }"
                            :has-previous="store.hasPrevious"
                            :has-next="store.hasNext"
                            :shuffle="store.shuffle"
                            :repeat="store.repeat"
                            :autoplay="store.autoplay"
                            :initial-volume="volume"
                            :initial-muted="muted"
                            :initial-rate="rate"
                            @ended="store.advance()"
                            @error="store.handleTrackError()"
                            @previous="store.previous()"
                            @next="store.next()"
                            @toggle-shuffle="store.toggleShuffle()"
                            @cycle-repeat="store.cycleRepeat()"
                            @volume-change="onVolumeChange"
                            @rate-change="onRateChange"
                        />
                    </div>
                </div>

                <div
                    v-else
                    class="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 rounded-lg border
                        border-dashed border-default text-center"
                >
                    <UIcon name="i-lucide-list-music" class="size-8 text-dimmed" />
                    <p class="text-sm text-muted">
                        The playlist is empty. Add media from your drive.
                    </p>
                </div>
            </div>

            <MediaPlaylist
                v-if="store.track?.kind !== 'video' || !playlistHidden"
                class="w-full lg:w-80 lg:shrink-0 lg:max-h-none lg:flex-none xl:w-96 2xl:w-112"
                :class="store.track?.kind === 'video' ? 'min-h-0 max-h-56 shrink-0' : 'min-h-40 flex-1'"
            />
        </div>
    </div>
</template>

<!--------------------------------------------------------------------------------------------------------------------->

<script setup lang="ts">
    import { computed, onMounted, onUnmounted, ref, useTemplateRef, watch } from 'vue';
    import { useToast } from '@nuxt/ui/composables';

    import type { NodeResponse } from '@fileshed/core';

    // Engines
    import { resolveMediaShortcut } from '../../../engines/media/keyboard.ts';
    import type { MediaKind, MediaTrack } from '../../../engines/media/queue.ts';

    // Stores
    import { useMediaPlayerStore } from '../../../stores/mediaPlayer.ts';

    // Resource Access
    import { downloadUrl } from '../../../resource-access/downloads.ts';

    // Components
    import AudioPlayer from './audioPlayer.vue';
    import MediaIdentityBar from './identityBar.vue';
    import MediaPlaylist from './playlist.vue';
    import VideoPlayer from './videoPlayer.vue';

    // Utils
    import { describeApiError } from '../../../utils/runWithToast.ts';

    //------------------------------------------------------------------------------------------------------------------

    defineOptions({ name: 'MediaPlayer' });

    const props = withDefaults(defineProps<{
        node : NodeResponse;
        media ?: MediaKind;
        playlist ?: boolean;
    }>(), { media: 'audio', playlist: false });

    const store = useMediaPlayerStore();
    const toast = useToast();

    // Drive tracks carry the session's playback token so a cast receiver -- handed this exact URL by the browser --
    // can fetch bytes without cookies. External stream URLs pass through untouched, and the user-facing download
    // href stays deliberately tokenless: no credential in a link someone might copy.
    function srcFor(entry : MediaTrack) : string
    {
        if(entry.remoteUrl !== null) { return entry.remoteUrl; }

        const src = downloadUrl(entry.nodeID, 'inline');
        const stamp = store.playbackToken;

        return stamp === null ? src : `${ src }&token=${ encodeURIComponent(stamp.token) }`;
    }

    function downloadHrefFor(entry : MediaTrack) : string
    {
        return entry.remoteUrl ?? downloadUrl(entry.nodeID);
    }

    //------------------------------------------------------------------------------------------------------------------
    // The listener's settings, carried across per-track remounts.
    //------------------------------------------------------------------------------------------------------------------

    const volume = ref(1);
    const muted = ref(false);
    const rate = ref(1);

    // The video bar's playlist toggle: hidden only applies while a video is up -- an audio card without its queue
    // would just be a smaller page.
    const playlistHidden = ref(false);

    const currentTags = computed(() => { return store.track === null ? null : store.tagsFor(store.track.nodeID); });

    function onVolumeChange(nextVolume : number, nextMuted : boolean) : void
    {
        volume.value = nextVolume;
        muted.value = nextMuted;
    }

    function onRateChange(nextRate : number) : void
    {
        rate.value = nextRate;
    }

    //------------------------------------------------------------------------------------------------------------------
    // Session lifecycle -- a media file opens as the session during setup (before the first render, so the surface
    // never flashes its empty state); a playlist file resolves asynchronously into the queue. Either way the store
    // follows the route if it swaps to another file, and resets on leave.
    //------------------------------------------------------------------------------------------------------------------

    async function openAsPlaylist() : Promise<void>
    {
        try
        {
            const { broken } = await store.openPlaylistNode(props.node, 'replace');
            if(broken > 0)
            {
                toast.add({
                    title: `${ broken } playlist ${ broken === 1 ? 'entry' : 'entries' } couldn't be resolved.`,
                    color: 'warning',
                });
            }
        }
        catch(caught)
        {
            toast.add({
                title: 'Couldn\'t open this playlist.',
                description: describeApiError(caught),
                color: 'error',
            });
        }
    }

    function openSession() : void
    {
        if(props.playlist) { void openAsPlaylist(); }
        else { store.open(props.node, props.media); }
    }

    openSession();

    watch(() => props.node.id, openSession);

    //------------------------------------------------------------------------------------------------------------------
    // Page-scoped keyboard shortcuts. The players' own focus-scoped handlers still work, but focus wanders -- a
    // playlist row click strands it on that row -- so the page listens at the window and drives the mounted player
    // through its exposed transport. Typing surfaces are exempt, and space defers to a focused button (activating
    // it is what the user meant); an event a player already handled is not handled twice.
    //------------------------------------------------------------------------------------------------------------------

    interface PlayerHandle
    {
        togglePlay : () => void;
        seekBy : (deltaSeconds : number) => void;
        adjustVolume : (delta : number) => void;
    }

    const player = useTemplateRef<PlayerHandle>('player');

    function shortcutsDeferTo(target : EventTarget | null, key : string) : boolean
    {
        if(!(target instanceof HTMLElement)) { return false; }
        if(target.isContentEditable) { return true; }
        if([ 'INPUT', 'TEXTAREA', 'SELECT' ].includes(target.tagName)) { return true; }

        return key === ' ' && (target.tagName === 'BUTTON' || target.tagName === 'A');
    }

    function onWindowKeydown(event : KeyboardEvent) : void
    {
        if(event.defaultPrevented || shortcutsDeferTo(event.target, event.key)) { return; }

        const shortcut = resolveMediaShortcut(event.key);
        if(shortcut === null || player.value === null) { return; }

        event.preventDefault();

        if(shortcut.type === 'toggle-play') { player.value.togglePlay(); }
        else if(shortcut.type === 'seek') { player.value.seekBy(shortcut.deltaSeconds); }
        else { player.value.adjustVolume(shortcut.delta); }
    }

    onMounted(() => { window.addEventListener('keydown', onWindowKeydown); });

    onUnmounted(() =>
    {
        window.removeEventListener('keydown', onWindowKeydown);
        store.reset();
    });

    // A queue-driven arrival on a broken playlist entry -- or one that already failed to play this session --
    // moves along to something playable rather than stalling, but only while something playable exists, or an
    // all-unplayable playlist would chase its own tail forever.
    watch(() => store.track, (current) =>
    {
        if(current === null || !(current.broken || current.failed) || !store.autoplay) { return; }
        if(!store.tracks.some((entry) => !entry.broken && !entry.failed)) { return; }

        store.next();
    });
</script>

<!--------------------------------------------------------------------------------------------------------------------->
