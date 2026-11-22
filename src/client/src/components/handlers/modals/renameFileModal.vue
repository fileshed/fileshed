<!----------------------------------------------------------------------------------------------------------------------
  -- Rename File Modal
  --------------------------------------------------------------------------------------------------------------------->

<template>
    <NameDialog
        v-model:open="open"
        title="Rename file"
        label="Name"
        submit-label="Save"
        :initial="name"
        :pending="pending"
        exclude-extension
        @submit="onSubmit"
    />
</template>

<!--------------------------------------------------------------------------------------------------------------------->

<script setup lang="ts">
    import { ref } from 'vue';

    // Components
    import NameDialog from '../../drive/nameDialog.vue';

    // Utils
    import { useRunWithToast } from '../../../utils/runWithToast.ts';

    //------------------------------------------------------------------------------------------------------------------

    defineOptions({ name: 'RenameFileModal' });

    const props = defineProps<{
        name : string;
        rename : (name : string) => Promise<void>;
    }>();

    const { runMutation } = useRunWithToast();

    const open = ref(false);
    const pending = ref(false);

    function openModal() : void
    {
        open.value = true;
    }

    function onSubmit(name : string) : void
    {
        if(name === props.name)
        {
            open.value = false;
            return;
        }

        void runMutation(() => props.rename(name), pending, () => { open.value = false; });
    }

    defineExpose({ open: openModal });
</script>

<!--------------------------------------------------------------------------------------------------------------------->
