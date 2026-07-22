<!----------------------------------------------------------------------------------------------------------------------
  -- Rename Modal
  --
  -- The Rename prompt, opened imperatively by the drive page for one node. The field prefills with the node's current
  -- name and stays open until the rename resolves, so a rejection can toast without the dialog vanishing under it.
  --------------------------------------------------------------------------------------------------------------------->

<template>
    <NameDialog
        v-model:open="open"
        title="Rename"
        label="Name"
        submit-label="Save"
        :initial="target?.name ?? ''"
        :pending="pending"
        @submit="onSubmit"
    />
</template>

<!--------------------------------------------------------------------------------------------------------------------->

<script setup lang="ts">
    import { ref } from 'vue';

    import type { NodeResponse } from '@fileshed/core';

    // Stores
    import { useDriveStore } from '../../../stores/drive.ts';

    // Components
    import NameDialog from '../nameDialog.vue';

    // Utils
    import { useRunWithToast } from '../../../utils/runWithToast.ts';

    //------------------------------------------------------------------------------------------------------------------

    const store = useDriveStore();
    const { runMutation } = useRunWithToast();

    const open = ref(false);
    const pending = ref(false);
    const target = ref<NodeResponse | null>(null);

    function openFor(node : NodeResponse) : void
    {
        target.value = node;
        open.value = true;
    }

    function onSubmit(name : string) : void
    {
        const node = target.value;
        if(!node) { return; }

        void runMutation(() => store.rename(node.id, name), pending, () => { open.value = false; });
    }

    defineExpose({ open: openFor });
</script>

<!--------------------------------------------------------------------------------------------------------------------->
