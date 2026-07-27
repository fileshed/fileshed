<!----------------------------------------------------------------------------------------------------------------------
  -- Media Player
  --
  -- The media family's host: the playing surface (video canvas, or the compact audio card centered where a canvas
  -- would be) beside the playlist, under an identity header that follows the queue. It owns the playlist session --
  -- opening the routed file into the store on mount, resetting on leave -- and the listener's settings: each change
  -- of playback intent remounts a fresh player (keyed on the store's play token), so volume, mute, and rate are
  -- caught on the way out of one mount and handed to the next, a queue-driven arrival starts playing on its own,
  -- and a track the browser can't decode is skipped rather than stalling the queue.
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
                    :key="playKey"
                    v-bind="{
                        src: srcFor(store.track),
                        downloadHref: downloadHrefFor(store.track),
                        name: store.track.name,
                        mimeType: store.track.mimeType,
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
                    @error="store.next()"
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
                            :key="playKey"
                            v-bind="{
                                src: srcFor(store.track),
                                downloadHref: downloadHrefFor(store.track),
                                name: store.track.name,
                                mimeType: store.track.mimeType,
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
                            @error="store.next()"
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
    import { computed, onUnmounted, ref, watch } from 'vue';
    import { useToast } from '@nuxt/ui/composables';

    import type { NodeResponse } from '@fileshed/core';

    // Engines
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

    function srcFor(entry : MediaTrack) : string
    {
        return entry.remoteUrl ?? downloadUrl(entry.nodeID, 'inline');
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

    // Keyed on the store's play token -- which moves only when playback intent changes -- so editing the rest of
    // the playlist never remounts (and never restarts) the playing track, while re-selecting the same file at
    // another queue position still does.
    const playKey = computed(() => store.playToken);

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
    onUnmounted(() => { store.reset(); });

    // A queue-driven arrival on a broken playlist entry moves along to something playable rather than stalling --
    // but only while something playable exists, or an all-broken playlist would chase its own tail forever.
    watch(() => store.track, (current) =>
    {
        if(current === null || !current.broken || !store.autoplay) { return; }
        if(!store.tracks.some((entry) => !entry.broken)) { return; }

        store.next();
    });
</script>

<!--------------------------------------------------------------------------------------------------------------------->
