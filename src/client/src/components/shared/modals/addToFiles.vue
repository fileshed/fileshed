<!----------------------------------------------------------------------------------------------------------------------
  -- Add To Files Modal
  --
  -- The destination picker for placing a link to a shared item into the caller's own tree, opened imperatively from the
  -- Shared with me kebab. Passes the folder picker an empty moving set -- creating a link carries none of the move
  -- engine's cycle restrictions, so every folder the caller owns, root included, is a legal destination.
  --------------------------------------------------------------------------------------------------------------------->

<template>
    <UModal v-model:open="open" :title="title" :dismissible="!pending">
        <template #body>
            <FolderPicker
                v-if="target !== null"
                :moving-node-i-ds="NO_MOVING_NODES"
                :pending="pending"
                verb="Add"
                @confirm="onSubmit"
                @cancel="open = false"
            />
        </template>
    </UModal>
</template>

<!--------------------------------------------------------------------------------------------------------------------->

<script setup lang="ts">
    import { computed, ref } from 'vue';
    import { useToast } from '@nuxt/ui/composables';

    import type { SharedTarget } from '@fileshed/core';

    // Stores
    import { useSharedStore } from '../../../stores/shared.ts';

    // Components
    import FolderPicker from '../../drive/folderPicker.vue';

    // Utils
    import { useRunWithToast } from '../../../utils/runWithToast.ts';

    //------------------------------------------------------------------------------------------------------------------

    const NO_MOVING_NODES : string[] = [];

    const store = useSharedStore();
    const toast = useToast();
    const { runMutation } = useRunWithToast();

    const open = ref(false);
    const pending = ref(false);
    const target = ref<SharedTarget | null>(null);

    const title = computed(() =>
    {
        return target.value !== null ? `Add "${ target.value.name }" to my files` : 'Add to my files';
    });

    function openFor(sharedTarget : SharedTarget) : void
    {
        target.value = sharedTarget;
        open.value = true;
    }

    function onSubmit(destinationParentID : string | null) : void
    {
        const current = target.value;
        if(current === null) { return; }

        void runMutation(
            () => store.addToFiles(current.id, destinationParentID),
            pending,
            () =>
            {
                open.value = false;
                toast.add({
                    title: 'Added to your files',
                    description: `"${ current.name }" is now in your files.`,
                    color: 'success',
                });
            }
        );
    }

    defineExpose({ open: openFor });
</script>

<!--------------------------------------------------------------------------------------------------------------------->
