<!----------------------------------------------------------------------------------------------------------------------
  -- PDF Identity Bar
  --------------------------------------------------------------------------------------------------------------------->

<template>
    <EditorHeaderSlot>
        <div class="flex min-w-0 items-center gap-2">
            <UIcon name="i-lucide-file-pen" class="shrink-0 text-dimmed" />
            <RenameTitle :name="store.node?.name ?? 'Untitled'" :read-only="store.readOnly" :rename="store.rename" />
            <SharingBadges :sharing="store.node?.sharing ?? null" />
            <FileActionsMenu
                v-if="store.node !== null"
                :node-i-d="store.node.id"
                :name="store.node.name"
                :read-only="store.readOnly"
                :rename="store.rename"
            />
        </div>

        <div class="ml-auto flex shrink-0 items-center gap-3">
            <SaveIndicator
                :saving="store.saving"
                :dirty="store.dirty"
                :last-saved="store.lastSaved"
                :save-error="store.saveError"
                @retry="store.save()"
            />

            <UBadge v-if="store.readOnly" color="neutral" variant="subtle" label="Read only" icon="i-lucide-eye" />
            <UButton
                v-else
                icon="i-lucide-save"
                label="Save"
                :loading="store.saving"
                :disabled="!store.dirty || store.saving"
                @click="store.save()"
            />
        </div>
    </EditorHeaderSlot>
</template>

<!--------------------------------------------------------------------------------------------------------------------->

<script setup lang="ts">
    import { computed } from 'vue';

    // Stores
    import { usePDFAnnotatorStore } from '../../../stores/pdfAnnotator.ts';

    // Components
    import EditorHeaderSlot from '../editorHeaderSlot.vue';
    import FileActionsMenu from '../fileActionsMenu.vue';
    import SharingBadges from '../../share/sharingBadges.vue';
    import RenameTitle from '../renameTitle.vue';
    import SaveIndicator from '../saveIndicator.vue';

    //------------------------------------------------------------------------------------------------------------------

    defineOptions({ name: 'PDFIdentityBar' });

    const store = usePDFAnnotatorStore();

</script>

<!--------------------------------------------------------------------------------------------------------------------->
