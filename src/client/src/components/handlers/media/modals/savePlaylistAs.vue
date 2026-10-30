<!----------------------------------------------------------------------------------------------------------------------
  -- Save Playlist As Modal
  --------------------------------------------------------------------------------------------------------------------->

<template>
    <UModal v-model:open="open" title="Save playlist as">
        <template #body>
            <form class="flex flex-col gap-4" @submit.prevent="submit">
                <UFormField label="File name">
                    <UInput v-model="name" placeholder="road-trip.m3u8" autofocus class="w-full" />
                </UFormField>

                <UFormField label="Title" hint="Optional" help="The display title other players show (#PLAYLIST).">
                    <UInput v-model="title" placeholder="Road Trip 2026" class="w-full" />
                </UFormField>

                <div class="flex justify-end gap-2">
                    <UButton color="neutral" variant="ghost" label="Cancel" :disabled="pending" @click="open = false" />
                    <UButton
                        type="submit"
                        label="Save"
                        icon="i-lucide-save"
                        :loading="pending"
                        :disabled="name.trim().length === 0"
                    />
                </div>
            </form>
        </template>
    </UModal>
</template>

<!--------------------------------------------------------------------------------------------------------------------->

<script setup lang="ts">
    import { ref } from 'vue';

    // Stores
    import { useMediaPlayerStore } from '../../../../stores/mediaPlayer.ts';

    // Utils
    import { useRunWithToast } from '../../../../utils/runWithToast.ts';

    //------------------------------------------------------------------------------------------------------------------

    const store = useMediaPlayerStore();
    const { runMutation } = useRunWithToast();

    const open = ref(false);
    const name = ref('');
    const title = ref('');
    const pending = ref(false);

    function submit() : void
    {
        const value = name.value.trim();
        if(value.length === 0) { return; }

        void runMutation(async () =>
        {
            await store.savePlaylistAs(value, title.value.trim() || null);
            open.value = false;
        }, pending);
    }

    defineExpose({
        open: () =>
        {
            name.value = store.playlistNode?.name ?? '';
            title.value = store.playlistTitle ?? '';
            open.value = true;
        },
    });
</script>

<!--------------------------------------------------------------------------------------------------------------------->
