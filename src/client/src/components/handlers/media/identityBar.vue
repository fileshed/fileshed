<!----------------------------------------------------------------------------------------------------------------------
  -- Media Identity Bar
  --
  -- The media player's contribution to the editor layout header: the current track's title and kind -- the embedded
  -- tag title with the artist beside it when the file carries them, the filename otherwise -- and its place in the
  -- queue once there is more than one track. It follows the queue, not the routed node: the header names what is
  -- playing. Players have no save path, so the right side stays empty.
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
        </div>
    </EditorHeaderSlot>
</template>

<!--------------------------------------------------------------------------------------------------------------------->

<script setup lang="ts">
    import { computed } from 'vue';

    // Stores
    import { useMediaPlayerStore } from '../../../stores/mediaPlayer.ts';

    // Components
    import EditorHeaderSlot from '../editorHeaderSlot.vue';

    //------------------------------------------------------------------------------------------------------------------

    defineOptions({ name: 'MediaIdentityBar' });

    const store = useMediaPlayerStore();

    const icon = computed(() =>
    {
        if(store.track === null) { return 'i-lucide-list-music'; }

        return store.track.kind === 'video' ? 'i-lucide-film' : 'i-lucide-music';
    });

    const currentTags = computed(() => { return store.track === null ? null : store.tagsFor(store.track.nodeID); });
    const title = computed(() => currentTags.value?.title ?? store.track?.name ?? 'Playlist');
    const artist = computed(() => currentTags.value?.artist ?? null);
</script>

<!--------------------------------------------------------------------------------------------------------------------->
