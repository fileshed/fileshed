<!----------------------------------------------------------------------------------------------------------------------
  -- Text Identity Bar
  --
  -- The text editor's contribution to the editor layout header: the file name and what it exposes, a save-state
  -- readout, and Save (a Read only badge in its place for a viewer). It reads and drives the shared editor store for
  -- the file session. The highlighting mode, colorscheme, and gutter controls -- which aren't identity -- stay on the
  -- toolbar row beside the editor, not here.
  --------------------------------------------------------------------------------------------------------------------->

<template>
    <EditorHeaderSlot>
        <div class="flex min-w-0 items-center gap-2">
            <UIcon name="i-lucide-file-pen" class="shrink-0 text-dimmed" />
            <RenameTitle :name="editor.node?.name ?? 'Untitled'" :read-only="editor.readOnly" :rename="editor.rename" />
            <SharingBadges :sharing="editor.node?.sharing ?? null" />
        </div>

        <div class="ml-auto flex shrink-0 items-center gap-3">
            <SaveIndicator
                :saving="editor.saving"
                :dirty="editor.dirty"
                :last-saved-at="editor.lastSavedAt"
                :save-error="editor.saveError"
            />

            <DownloadAction v-if="editor.node !== null" :node-i-d="editor.node.id" />

            <UBadge v-if="editor.readOnly" color="neutral" variant="subtle" label="Read only" icon="i-lucide-eye" />
            <UButton
                v-else
                icon="i-lucide-save"
                label="Save"
                :loading="editor.saving"
                :disabled="!editor.dirty || editor.saving"
                @click="editor.save()"
            />
        </div>
    </EditorHeaderSlot>
</template>

<!--------------------------------------------------------------------------------------------------------------------->

<script setup lang="ts">
    import { computed } from 'vue';

    // Stores
    import { useEditorStore } from '../../../stores/editor.ts';

    // Components
    import DownloadAction from '../downloadAction.vue';
    import EditorHeaderSlot from '../editorHeaderSlot.vue';
    import SharingBadges from '../../share/sharingBadges.vue';
    import RenameTitle from '../renameTitle.vue';
    import SaveIndicator from '../saveIndicator.vue';

    //------------------------------------------------------------------------------------------------------------------

    defineOptions({ name: 'TextIdentityBar' });

    const editor = useEditorStore();

</script>

<!--------------------------------------------------------------------------------------------------------------------->
