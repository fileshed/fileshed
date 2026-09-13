<!----------------------------------------------------------------------------------------------------------------------
  -- New Link Modal
  --
  -- The target half of placing a link: the caller is standing in the folder the pointer goes in, and this asks what to
  -- point at. Self-subscribed to the sidebar's create signal, like the other New dialogs, and creating in whichever
  -- folder is open when the request lands.
  --
  -- A folder is as linkable as a file, so folder rows carry a Link button of their own beside the navigation the row
  -- already does -- entering a folder and choosing it are different intents and both have to be reachable. The picker
  -- omits links entirely, which is also the rule the server would enforce: a link may not point at another link.
  --------------------------------------------------------------------------------------------------------------------->

<template>
    <UModal v-model:open="open" title="Link to a file or folder" :dismissible="!pending">
        <template #body>
            <FilePicker
                :accept="ANY_FILE"
                :pending="pending"
                folder-addable
                folder-action-label="Link"
                folder-action-icon="i-lucide-link"
                caption="Pick what the link should point at."
                @select="onPick"
                @select-folder="onPick"
                @cancel="open = false"
            />
        </template>
    </UModal>
</template>

<!--------------------------------------------------------------------------------------------------------------------->

<script setup lang="ts">
    import { ref, watch } from 'vue';
    import { useToast } from '@nuxt/ui/composables';

    import type { NodeResponse } from '@fileshed/core';

    // Stores
    import { useDriveStore } from '../../../stores/drive.ts';
    import { useNewItemStore } from '../../../stores/newItem.ts';

    // Components
    import FilePicker from '../filePicker.vue';

    // Utils
    import { useRunWithToast } from '../../../utils/runWithToast.ts';

    //------------------------------------------------------------------------------------------------------------------

    // Anything at all: a link points at whatever the caller can read, and narrowing that here would only hide from
    // them what the server would happily accept.
    const ANY_FILE = [ '*' ];

    const store = useDriveStore();
    const newItem = useNewItemStore();
    const toast = useToast();
    const { runMutation } = useRunWithToast();

    const open = ref(false);
    const pending = ref(false);

    // Only a link request is ours; another kind's is left untouched for its own modal to consume.
    watch(() => newItem.request, (request) =>
    {
        if(request?.kind !== 'link') { return; }

        newItem.consume();
        open.value = true;
    }, { immediate: true });

    function onPick(node : NodeResponse) : void
    {
        void runMutation(
            () => store.createLink(node.id),
            pending,
            () =>
            {
                open.value = false;
                toast.add({ title: `Linked "${ node.name }".`, color: 'success' });
            }
        );
    }
</script>

<!--------------------------------------------------------------------------------------------------------------------->
