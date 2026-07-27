<!----------------------------------------------------------------------------------------------------------------------
  -- Playlist Panel
  --
  -- The queue beside the playing surface: one row per track in play order, the current one highlighted, a click
  -- anywhere on a row jumps playback there, and each row can be removed without stopping what's playing. Rows wear
  -- the file's embedded title and artist once the store has read them, falling back to the filename; a broken
  -- playlist entry sits dimmed and unclickable. The header carries the playlist's display title (its file name
  -- until one is set) once a file is adopted -- click-to-edit, Docs-style, written through to the file's #PLAYLIST
  -- line -- and the session's file actions: Open (replace or append via prompt), Save (overwrite the adopted
  -- file), Save As, and Add. The rows read from and act on the media player store directly -- this panel is the
  -- queue's own UI, not a reusable list.
  --------------------------------------------------------------------------------------------------------------------->

<template>
    <div class="flex min-h-0 flex-col rounded-lg border border-default bg-elevated">
        <div class="flex shrink-0 items-center gap-2 border-b border-default px-3 py-2">
            <UIcon name="i-lucide-list-music" class="shrink-0 text-dimmed" />
            <RenameTitle
                v-if="store.playlistNode !== null"
                class="min-w-0 text-sm"
                :name="store.playlistTitle ?? store.playlistNode.name"
                :read-only="store.playlistBusy"
                :rename="retitle"
                tooltip="Edit title"
                input-label="Playlist title"
            />
            <span v-else class="min-w-0 truncate text-sm font-medium">Playlist</span>
            <span v-if="store.tracks.length > 0" class="shrink-0 text-xs text-dimmed">{{ store.tracks.length }}</span>

            <div class="ml-auto flex shrink-0 items-center gap-0.5">
                <UButton
                    icon="i-lucide-folder-open"
                    color="neutral"
                    variant="ghost"
                    size="xs"
                    :disabled="store.playlistBusy"
                    aria-label="Open playlist"
                    @click="openModal?.open()"
                />
                <UButton
                    icon="i-lucide-save"
                    color="neutral"
                    variant="ghost"
                    size="xs"
                    :disabled="store.playlistNode === null || store.playlistBusy"
                    :loading="store.playlistBusy"
                    aria-label="Save playlist"
                    @click="save"
                />
                <UButton
                    icon="i-lucide-save-all"
                    color="neutral"
                    variant="ghost"
                    size="xs"
                    :disabled="store.tracks.length === 0 || store.playlistBusy"
                    aria-label="Save playlist as"
                    @click="saveAsModal?.open()"
                />
                <UButton
                    icon="i-lucide-plus"
                    color="neutral"
                    variant="ghost"
                    size="xs"
                    aria-label="Add media"
                    @click="addModal?.open()"
                />
            </div>
        </div>

        <div class="min-h-0 flex-1 overflow-y-auto">
            <p v-if="store.tracks.length === 0" class="px-3 py-6 text-center text-sm text-dimmed">
                Nothing queued. Add media from your drive.
            </p>

            <div
                v-for="(entry, index) in store.tracks"
                v-else
                :key="`${ index }:${ entry.nodeID }`"
                class="group flex items-center gap-1 border-b border-default last:border-b-0"
                :class="{ 'bg-primary/10': index === store.currentIndex }"
            >
                <button
                    type="button"
                    class="flex min-w-0 flex-1 items-center gap-2 px-3 py-2 text-left text-sm
                        enabled:hover:bg-elevated/50 disabled:opacity-40"
                    :aria-current="index === store.currentIndex ? 'true' : undefined"
                    :disabled="entry.broken"
                    @click="store.select(index)"
                >
                    <UIcon
                        :name="rowIcon(entry)"
                        class="size-4 shrink-0"
                        :class="index === store.currentIndex ? 'text-primary' : 'text-dimmed'"
                    />
                    <span class="flex min-w-0 flex-col">
                        <span class="truncate" :class="{ 'text-primary': index === store.currentIndex }">
                            {{ store.tagsFor(entry.nodeID)?.title ?? entry.name }}
                        </span>
                        <span
                            v-if="store.tagsFor(entry.nodeID)?.artist"
                            class="truncate text-xs text-dimmed"
                        >
                            {{ store.tagsFor(entry.nodeID)?.artist }}
                        </span>
                    </span>
                </button>

                <UButton
                    icon="i-lucide-x"
                    color="neutral"
                    variant="ghost"
                    size="xs"
                    class="mr-2 shrink-0 opacity-0 transition group-hover:opacity-100 focus-visible:opacity-100"
                    :aria-label="`Remove ${ entry.name } from playlist`"
                    @click="store.removeTrack(index)"
                />
            </div>
        </div>

        <AddMediaModal ref="addModal" />
        <OpenPlaylistModal ref="openModal" />
        <SavePlaylistAsModal ref="saveAsModal" />
    </div>
</template>

<!--------------------------------------------------------------------------------------------------------------------->

<script setup lang="ts">
    import { useTemplateRef } from 'vue';

    // Engines
    import type { MediaTrack } from '../../../engines/media/queue.ts';

    // Stores
    import { useMediaPlayerStore } from '../../../stores/mediaPlayer.ts';

    // Components
    import RenameTitle from '../renameTitle.vue';
    import AddMediaModal from './modals/addMedia.vue';
    import OpenPlaylistModal from './modals/openPlaylist.vue';
    import SavePlaylistAsModal from './modals/savePlaylistAs.vue';

    // Utils
    import { useRunWithToast } from '../../../utils/runWithToast.ts';

    //------------------------------------------------------------------------------------------------------------------

    defineOptions({ name: 'MediaPlaylist' });

    const store = useMediaPlayerStore();
    const { runMutation } = useRunWithToast();

    const addModal = useTemplateRef<InstanceType<typeof AddMediaModal>>('addModal');
    const openModal = useTemplateRef<InstanceType<typeof OpenPlaylistModal>>('openModal');
    const saveAsModal = useTemplateRef<InstanceType<typeof SavePlaylistAsModal>>('saveAsModal');

    function rowIcon(entry : MediaTrack) : string
    {
        if(entry.broken) { return 'i-lucide-file-question'; }

        return entry.kind === 'video' ? 'i-lucide-film' : 'i-lucide-music';
    }

    function save() : void
    {
        void runMutation(() => store.savePlaylist());
    }

    function retitle(title : string) : Promise<void>
    {
        return store.retitlePlaylist(title);
    }
</script>

<!--------------------------------------------------------------------------------------------------------------------->
