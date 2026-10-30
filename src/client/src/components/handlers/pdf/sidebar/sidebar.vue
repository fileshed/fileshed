<!----------------------------------------------------------------------------------------------------------------------
  -- PDF Sidebar
  --
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
            <PDFThumbnailRail v-if="store.sidebarTab === 'thumbnails'" />
            <PDFOutlineTree v-else-if="store.sidebarTab === 'outline'" />
            <PDFAttachmentList v-else />
        </div>
    </div>
</template>

<!--------------------------------------------------------------------------------------------------------------------->

<script setup lang="ts">
    import { computed } from 'vue';

    // Stores
    import { usePDFAnnotatorStore } from '../../../../stores/pdfAnnotator.ts';

    // Engines
    import type { SidebarTab } from '../../../../engines/pdf/types.ts';

    // Components
    import PDFAttachmentList from './attachmentList.vue';
    import PDFOutlineTree from './outlineTree.vue';
    import PDFThumbnailRail from './thumbnailRail.vue';

    //------------------------------------------------------------------------------------------------------------------

    defineOptions({ name: 'PDFSidebar' });

    const store = usePDFAnnotatorStore();

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
