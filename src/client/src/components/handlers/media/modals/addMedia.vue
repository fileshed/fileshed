<!----------------------------------------------------------------------------------------------------------------------
  -- Add Media Modal
  --
  -- The playlist's browse-and-add: a file picker over the caller's drive constrained to audio and video, where every
  -- pick appends to the queue and the picker stays open -- building a playlist is a run of picks, not one choice.
  -- Rows already in the queue wear a check, folder rows carry an Add-all that queues the folder's media (recursing
  -- into subfolders), and the caption keeps a running count so every action lands visibly. Imperative: the playlist
  -- opens it via the exposed open().
  --------------------------------------------------------------------------------------------------------------------->

<template>
    <UModal v-model:open="open" title="Add to playlist">
        <template #body>
            <FilePicker
                :accept="[ 'audio/*', 'video/*' ]"
                :caption="caption"
                cancel-label="Done"
                :pending="adding"
                v-bind="{ pickedIDs: queuedIDs }"
                folder-addable
                @select="onSelect"
                @select-folder="onSelectFolder"
                @cancel="open = false"
            />
        </template>
    </UModal>
</template>

<!--------------------------------------------------------------------------------------------------------------------->

<script setup lang="ts">
    import { computed, ref } from 'vue';

    import type { NodeResponse } from '@fileshed/core';

    // Stores
    import { useMediaPlayerStore } from '../../../../stores/mediaPlayer.ts';

    // Components
    import FilePicker from '../../../drive/filePicker.vue';

    //------------------------------------------------------------------------------------------------------------------

    const store = useMediaPlayerStore();
    const open = ref(false);
    const adding = ref(false);
    const feedback = ref<string | null>(null);

    const queuedIDs = computed(() => new Set(store.tracks.map((entry) => entry.nodeID)));

    const caption = computed(() =>
    {
        const count = store.tracks.length;
        const tally = `${ count } in playlist`;

        return feedback.value === null ? `${ tally } — every pick adds another.` : `${ tally } — ${ feedback.value }`;
    });

    function onSelect(node : NodeResponse) : void
    {
        feedback.value = null;
        store.add(node);
    }

    async function onSelectFolder(node : NodeResponse) : Promise<void>
    {
        adding.value = true;

        try
        {
            const seated = await store.addFolder(node.id);
            feedback.value = seated > 0
                ? `added ${ seated } from “${ node.name }”.`
                : `no media in “${ node.name }”.`;
        }
        catch
        {
            feedback.value = `couldn't read “${ node.name }”.`;
        }
        finally
        {
            adding.value = false;
        }
    }

    defineExpose({
        open: () =>
        {
            feedback.value = null;
            open.value = true;
        },
    });
</script>

<!--------------------------------------------------------------------------------------------------------------------->
