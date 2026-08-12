<!----------------------------------------------------------------------------------------------------------------------
  -- Media Identity Bar
  --
  -- The media player's contribution to the editor layout header: the current track's title and kind -- the embedded
  -- tag title with the artist beside it when the file carries them, the filename otherwise -- and its place in the
  -- queue once there is more than one track, plus what that track exposes. It follows the queue, not the routed node:
  -- the header names what is playing.
  --------------------------------------------------------------------------------------------------------------------->

<template>
    <EditorHeaderSlot>
        <div class="flex min-w-0 items-center gap-2">
            <UIcon :name="icon" class="shrink-0 text-dimmed" />
            <span class="truncate font-medium">{{ title }}</span>
            <span v-if="artist !== null" class="truncate text-sm text-dimmed">{{ artist }}</span>
            <span v-if="store.tracks.length > 1" class="shrink-0 text-xs text-dimmed">
                {{ store.currentIndex + 1 }} of {{ store.tracks.length }}
            </span>
            <SharingBadges :sharing="sharing" />
        </div>

        <div v-if="downloadableID !== null" class="ml-auto shrink-0">
            <DownloadAction :node-i-d="downloadableID" />
        </div>
    </EditorHeaderSlot>
</template>

<!--------------------------------------------------------------------------------------------------------------------->

<script setup lang="ts">
    import { computed } from 'vue';

    // Stores
    import { useMediaPlayerStore } from '../../../stores/mediaPlayer.ts';

    // Components
    import DownloadAction from '../downloadAction.vue';
    import EditorHeaderSlot from '../editorHeaderSlot.vue';
    import SharingBadges from '../../share/sharingBadges.vue';

    // Utils
    import { useNodeSharing } from '../../../utils/nodeSharing.ts';

    //------------------------------------------------------------------------------------------------------------------

    defineOptions({ name: 'MediaIdentityBar' });

    const store = useMediaPlayerStore();

    const icon = computed(() =>
    {
        if(store.track === null) { return 'i-lucide-list-music'; }

        return store.track.kind === 'video' ? 'i-lucide-film' : 'i-lucide-music';
    });

    // Only a drive track has bytes to hand over: a remote stream is somebody else's URL, and a broken row stands in
    // for a playlist entry that resolved to no node at all.
    const downloadableID = computed<string | null>(() =>
    {
        const track = store.track;
        if(track === null || track.remoteUrl !== null || track.broken) { return null; }

        return track.nodeID;
    });

    // The playing track's sharing, not the routed node's -- the bar names what is playing, so the badges do too.
    const { sharing } = useNodeSharing(downloadableID);

    const currentTags = computed(() => { return store.track === null ? null : store.tagsFor(store.track.nodeID); });
    const title = computed(() => currentTags.value?.title ?? store.track?.name ?? 'Playlist');
    const artist = computed(() => currentTags.value?.artist ?? null);
</script>

<!--------------------------------------------------------------------------------------------------------------------->
