<!----------------------------------------------------------------------------------------------------------------------
  -- New Folder Modal
  --------------------------------------------------------------------------------------------------------------------->

<template>
    <NameDialog
        v-model:open="open"
        title="New folder"
        label="Folder name"
        submit-label="Create"
        :pending="pending"
        @submit="onSubmit"
    />
</template>

<!--------------------------------------------------------------------------------------------------------------------->

<script setup lang="ts">
    import { ref, watch } from 'vue';

    // Stores
    import { useDriveStore } from '../../../stores/drive.ts';
    import { useNewItemStore } from '../../../stores/newItem.ts';

    // Components
    import NameDialog from '../nameDialog.vue';

    // Utils
    import { useRunWithToast } from '../../../utils/runWithToast.ts';

    //------------------------------------------------------------------------------------------------------------------

    const store = useDriveStore();
    const newItem = useNewItemStore();
    const { runMutation } = useRunWithToast();

    const open = ref(false);
    const pending = ref(false);

    // Only a folder request is ours; another kind's request is left untouched for its own modal to consume.
    watch(() => newItem.request, (request) =>
    {
        if(request?.kind !== 'folder') { return; }

        newItem.consume();
        open.value = true;
    }, { immediate: true });

    function onSubmit(name : string) : void
    {
        void runMutation(() => store.createFolder(name), pending, () => { open.value = false; });
    }
</script>

<!--------------------------------------------------------------------------------------------------------------------->
