<!----------------------------------------------------------------------------------------------------------------------
  -- Move Modal
  --
  -- Targets move one at a time, so each move's refetch settles before the next starts instead of racing overlapping
  -- refreshes.
  --------------------------------------------------------------------------------------------------------------------->

<template>
    <UModal v-model:open="open" :title="title" :dismissible="!pending">
        <template #body>
            <FolderPicker
                v-if="targets.length > 0"
                :moving-node-i-ds="targetIDs"
                :pending="pending"
                @confirm="onSubmit"
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
    import { useDriveStore } from '../../../stores/drive.ts';

    // Components
    import FolderPicker from '../folderPicker.vue';

    // Utils
    import { useRunWithToast } from '../../../utils/runWithToast.ts';

    //------------------------------------------------------------------------------------------------------------------

    const store = useDriveStore();
    const { runMutation } = useRunWithToast();

    const open = ref(false);
    const pending = ref(false);
    const targets = ref<NodeResponse[]>([]);

    const targetIDs = computed(() => targets.value.map((node) => node.id));

    const title = computed(() =>
    {
        if(targets.value.length === 1) { return `Move "${ targets.value[0]?.name }"`; }
        if(targets.value.length > 1) { return `Move ${ targets.value.length } items`; }

        return 'Move';
    });

    function openFor(nodes : NodeResponse[]) : void
    {
        targets.value = nodes;
        open.value = true;
    }

    function onSubmit(destinationParentID : string | null) : void
    {
        const ids = targetIDs.value;
        if(ids.length === 0) { return; }

        void runMutation(
            async () =>
            {
                for(const id of ids)
                {
                    // eslint-disable-next-line no-await-in-loop
                    await store.move(id, destinationParentID);
                }
            },
            pending,
            () => { open.value = false; }
        );
    }

    defineExpose({ open: openFor });
</script>

<!--------------------------------------------------------------------------------------------------------------------->
