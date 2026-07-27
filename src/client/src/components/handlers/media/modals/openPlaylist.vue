<!----------------------------------------------------------------------------------------------------------------------
  -- Open Playlist Modal
  --
  -- Browse-and-pick over the drive, constrained to playlist files. With a queue already playing, a pick asks
  -- whether to open (replace the queue -- the picked playlist becomes what Save overwrites) or append (pour its
  -- tracks in, ownership unchanged); an empty session just opens. Entries that can't be resolved are reported by
  -- count -- they stay visible in the queue as broken rows. Imperative: the playlist panel opens it via the
  -- exposed open().
  --------------------------------------------------------------------------------------------------------------------->

<template>
    <UModal v-model:open="open" title="Open playlist">
        <template #body>
            <div v-if="picked === null">
                <FilePicker
                    :accept="playlistAccept"
                    caption="Pick a playlist file."
                    :pending="pending"
                    @select="onSelect"
                    @cancel="open = false"
                />
            </div>

            <div v-else class="space-y-4">
                <p class="text-sm text-muted">
                    Open <span class="font-medium text-default">{{ picked.name }}</span> in place of the current
                    queue, or append its tracks to it?
                </p>

                <div class="flex justify-end gap-2">
                    <UButton color="neutral" variant="ghost" label="Cancel" :disabled="pending" @click="picked = null" />
                    <UButton
                        color="neutral"
                        variant="subtle"
                        label="Append"
                        icon="i-lucide-list-plus"
                        :disabled="pending"
                        @click="confirm('append')"
                    />
                    <UButton label="Open" icon="i-lucide-folder-open" :loading="pending" @click="confirm('replace')" />
                </div>
            </div>
        </template>
    </UModal>
</template>

<!--------------------------------------------------------------------------------------------------------------------->

<script setup lang="ts">
    import { ref } from 'vue';
    import { useToast } from '@nuxt/ui/composables';

    import { type NodeResponse, PLAYLIST_EXTENSIONS, PLAYLIST_MIME_TYPES } from '@fileshed/core';

    // Stores
    import { useMediaPlayerStore } from '../../../../stores/mediaPlayer.ts';

    // Components
    import FilePicker from '../../../drive/filePicker.vue';

    // Utils
    import { describeApiError } from '../../../../utils/runWithToast.ts';

    //------------------------------------------------------------------------------------------------------------------

    const store = useMediaPlayerStore();
    const toast = useToast();

    const open = ref(false);
    const picked = ref<NodeResponse | null>(null);
    const pending = ref(false);

    const playlistAccept = [ ...PLAYLIST_MIME_TYPES, ...PLAYLIST_EXTENSIONS ];

    async function confirm(mode : 'replace' | 'append') : Promise<void>
    {
        const node = picked.value;
        if(node === null) { return; }

        pending.value = true;

        try
        {
            const { broken } = await store.openPlaylistNode(node, mode);

            if(broken > 0)
            {
                toast.add({
                    title: `${ broken } playlist ${ broken === 1 ? 'entry' : 'entries' } couldn't be resolved.`,
                    color: 'warning',
                });
            }

            open.value = false;
            picked.value = null;
        }
        catch(caught)
        {
            toast.add({
                title: 'Couldn\'t open this playlist.',
                description: describeApiError(caught),
                color: 'error',
            });
        }
        finally
        {
            pending.value = false;
        }
    }

    function onSelect(node : NodeResponse) : void
    {
        picked.value = node;

        if(store.tracks.length === 0) { void confirm('replace'); }
    }

    defineExpose({
        open: () =>
        {
            picked.value = null;
            open.value = true;
        },
    });
</script>

<!--------------------------------------------------------------------------------------------------------------------->
