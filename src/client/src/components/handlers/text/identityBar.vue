<!----------------------------------------------------------------------------------------------------------------------
  -- Text Identity Bar
  --------------------------------------------------------------------------------------------------------------------->

<template>
    <EditorHeaderSlot>
        <div class="flex min-w-0 items-center gap-2">
            <UIcon name="i-lucide-file-pen" class="shrink-0 text-dimmed" />
            <RenameTitle :name="editor.node?.name ?? 'Untitled'" :read-only="editor.readOnly" :rename="editor.rename" />
            <SharingBadges :sharing="editor.node?.sharing ?? null" />
            <FileActionsMenu
                v-if="editor.node !== null"
                :node-i-d="editor.node.id"
                :name="editor.node.name"
                :read-only="editor.readOnly"
                :rename="editor.rename"
            />
        </div>

        <div class="ml-auto flex shrink-0 items-center gap-3">
            <SaveIndicator
                :saving="editor.saving"
                :dirty="editor.dirty"
                :last-saved="editor.lastSaved"
                :save-error="editor.saveError"
                @retry="editor.save()"
            />

            <UBadge v-if="editor.readOnly" color="neutral" variant="subtle" label="Read only" icon="i-lucide-eye" />
        </div>
    </EditorHeaderSlot>
</template>

<!--------------------------------------------------------------------------------------------------------------------->

<script setup lang="ts">
    import { computed } from 'vue';

    // Stores
    import { useEditorStore } from '../../../stores/editor.ts';

    // Components
    import EditorHeaderSlot from '../editorHeaderSlot.vue';
    import FileActionsMenu from '../fileActionsMenu.vue';
    import SharingBadges from '../../share/sharingBadges.vue';
    import RenameTitle from '../renameTitle.vue';
    import SaveIndicator from '../saveIndicator.vue';

    //------------------------------------------------------------------------------------------------------------------

    defineOptions({ name: 'TextIdentityBar' });

    const editor = useEditorStore();

</script>

<!--------------------------------------------------------------------------------------------------------------------->
