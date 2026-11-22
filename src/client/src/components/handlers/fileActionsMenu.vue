<!----------------------------------------------------------------------------------------------------------------------
  -- File Actions Menu
  --
  -- The handler's own entries sit between Rename and Download.
  --------------------------------------------------------------------------------------------------------------------->

<template>
    <UDropdownMenu :items="menuItems" :content="{ align: 'start', onCloseAutoFocus }">
        <UButton
            icon="i-lucide-ellipsis-vertical"
            color="neutral"
            variant="ghost"
            size="sm"
            aria-label="File actions"
            class="shrink-0"
        />
    </UDropdownMenu>

    <RenameFileModal ref="renameModal" :name="name" :rename="rename" />
</template>

<!--------------------------------------------------------------------------------------------------------------------->

<script setup lang="ts">
    import { computed, useTemplateRef } from 'vue';
    import type { DropdownMenuItem } from '@nuxt/ui';

    // Resource Access
    import { downloadURL } from '../../resource-access/downloads.ts';

    // Components
    import RenameFileModal from './modals/renameFileModal.vue';

    //------------------------------------------------------------------------------------------------------------------

    defineOptions({ name: 'FileActionsMenu' });

    const props = withDefaults(defineProps<{
        nodeID : string;
        name : string;
        readOnly : boolean;
        rename : (name : string) => Promise<void>;
        items ?: DropdownMenuItem[];
    }>(), { items: () => [] });

    const renameModal = useTemplateRef<InstanceType<typeof RenameFileModal>>('renameModal');

    const menuItems = computed<DropdownMenuItem[]>(() =>
    {
        const rename : DropdownMenuItem[] = props.readOnly ? [] : [ {
            label: 'Rename file',
            icon: 'i-lucide-pencil',
            onSelect: () => { renameModal.value?.open(); },
        } ];

        // External, so the router leaves the API route to the browser, which saves the attachment.
        const download : DropdownMenuItem = {
            label: 'Download',
            icon: 'i-lucide-download',
            to: downloadURL(props.nodeID),
            external: true,
        };

        return [ ...rename, ...props.items, download ];
    });

    // An entry that opens a dialog hands it focus. Sending focus back to the trigger as the menu closes would pull it
    // out of the dialog, and the dialog's focus trap selects the whole field on the way back in.
    function onCloseAutoFocus(event : Event) : void
    {
        if(document.activeElement?.closest('[role="dialog"]')) { event.preventDefault(); }
    }
</script>

<!--------------------------------------------------------------------------------------------------------------------->
