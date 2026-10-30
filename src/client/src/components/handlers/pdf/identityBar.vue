<!----------------------------------------------------------------------------------------------------------------------
  -- PDF Identity Bar
  --------------------------------------------------------------------------------------------------------------------->

<template>
    <EditorHeaderSlot>
        <div class="flex min-w-0 items-center gap-2">
            <UIcon name="i-lucide-file-pen" class="shrink-0 text-dimmed" />
            <RenameTitle :name="store.node?.name ?? 'Untitled'" :read-only="store.readOnly" :rename="store.rename" />
            <SharingBadges :sharing="store.node?.sharing ?? null" />
        </div>

        <div class="ml-auto flex shrink-0 items-center gap-3">
            <SaveIndicator
                :saving="store.saving"
                :dirty="store.dirty"
                :last-saved-at="store.lastSavedAt"
                :save-error="store.saveError"
            />

            <DownloadAction v-if="store.node !== null" :node-i-d="store.node.id" />

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
    import { usePdfAnnotatorStore } from '../../../stores/pdfAnnotator.ts';

    // Components
    import DownloadAction from '../downloadAction.vue';
    import EditorHeaderSlot from '../editorHeaderSlot.vue';
    import SharingBadges from '../../share/sharingBadges.vue';
    import RenameTitle from '../renameTitle.vue';
    import SaveIndicator from '../saveIndicator.vue';

    //------------------------------------------------------------------------------------------------------------------

    defineOptions({ name: 'PdfIdentityBar' });

    const store = usePdfAnnotatorStore();

</script>

<!--------------------------------------------------------------------------------------------------------------------->
