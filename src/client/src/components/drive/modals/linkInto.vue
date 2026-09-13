<!----------------------------------------------------------------------------------------------------------------------
  -- Link Into Modal
  --
  -- The destination half of placing a link: the caller has picked what to point at, and this asks where the pointer
  -- goes. Opened imperatively from a node's own menu.
  --
  -- The folder picker is handed an empty moving set, as the shared-item version is: a link carries none of the move
  -- engine's cycle restrictions, because it conducts nothing. Pointing a folder's link at a folder inside itself is
  -- an odd thing to do and a legal one, so every folder the caller owns is a destination, root included.
  --------------------------------------------------------------------------------------------------------------------->

<template>
    <UModal v-model:open="open" :title="title" :dismissible="!pending">
        <template #body>
            <FolderPicker
                v-if="target !== null"
                :moving-node-i-ds="NO_MOVING_NODES"
                :pending="pending"
                verb="Link"
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

    import type { NodeResponse } from '@fileshed/core';

    // Stores
    import { useDriveStore } from '../../../stores/drive.ts';

    // Components
    import FolderPicker from '../folderPicker.vue';

    // Utils
    import { useRunWithToast } from '../../../utils/runWithToast.ts';

    //------------------------------------------------------------------------------------------------------------------

    const NO_MOVING_NODES : string[] = [];

    const store = useDriveStore();
    const toast = useToast();
    const { runMutation } = useRunWithToast();

    const open = ref(false);
    const pending = ref(false);
    const target = ref<NodeResponse | null>(null);

    const title = computed(() =>
    {
        return target.value === null ? 'Add a link' : `Add a link to "${ target.value.name }"`;
    });

    function openFor(node : NodeResponse) : void
    {
        target.value = node;
        open.value = true;
    }

    function onSubmit(destinationParentID : string | null) : void
    {
        const current = target.value;
        if(current === null) { return; }

        void runMutation(
            () => store.createLink(current.id, destinationParentID),
            pending,
            () =>
            {
                open.value = false;
                toast.add({ title: `Linked "${ current.name }".`, color: 'success' });
            }
        );
    }

    defineExpose({ open: openFor });
</script>

<!--------------------------------------------------------------------------------------------------------------------->
