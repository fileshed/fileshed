<!----------------------------------------------------------------------------------------------------------------------
  -- PDF Sidebar
  --
  -- The navigation rail beside the render surface: page thumbnails, the document outline, and embedded attachments.
  -- Every tab navigates by commanding the store, never by reaching into pdf.js. A tab whose document has nothing behind
  -- it is disabled rather than hidden, so the rail does not change width between documents.
  --------------------------------------------------------------------------------------------------------------------->

<template>
    <div class="flex w-56 shrink-0 flex-col border-r border-default bg-elevated/30">
        <div class="flex shrink-0 items-center gap-1 border-b border-default p-1">
            <UButton
                v-for="tab in tabs"
                :key="tab.value"
                :icon="tab.icon"
                :aria-label="tab.label"
                :title="tab.label"
                :variant="store.sidebarTab === tab.value ? 'solid' : 'ghost'"
                :disabled="tab.empty"
                color="neutral"
                size="sm"
                class="flex-1 justify-center"
                @click="store.showSidebarTab(tab.value)"
            />
        </div>

        <div class="min-h-0 flex-1 overflow-y-auto">
            <PdfThumbnailRail v-if="store.sidebarTab === 'thumbnails'" />
            <PdfOutlineTree v-else-if="store.sidebarTab === 'outline'" />
            <PdfAttachmentList v-else />
        </div>
    </div>
</template>

<!--------------------------------------------------------------------------------------------------------------------->

<script setup lang="ts">
    import { computed } from 'vue';

    // Stores
    import { usePdfAnnotatorStore } from '../../../../stores/pdfAnnotator.ts';

    // Components
    import type { SidebarTab } from '../types.ts';
    import PdfAttachmentList from './attachmentList.vue';
    import PdfOutlineTree from './outlineTree.vue';
    import PdfThumbnailRail from './thumbnailRail.vue';

    //------------------------------------------------------------------------------------------------------------------

    defineOptions({ name: 'PdfSidebar' });

    const store = usePdfAnnotatorStore();

    const tabs = computed<{ value : SidebarTab; icon : string; label : string; empty : boolean }[]>(() =>
    {
        return [
            { value: 'thumbnails', icon: 'i-lucide-layout-grid', label: 'Page thumbnails', empty: false },
            {
                value: 'outline',
                icon: 'i-lucide-list-tree',
                label: 'Document outline',
                empty: store.outline.length === 0,
            },
            {
                value: 'attachments',
                icon: 'i-lucide-paperclip',
                label: 'Attachments',
                empty: store.attachments.length === 0,
            },
        ];
    });
</script>

<!--------------------------------------------------------------------------------------------------------------------->
