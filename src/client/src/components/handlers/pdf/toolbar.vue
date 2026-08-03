<!----------------------------------------------------------------------------------------------------------------------
  -- PDF Annotator Toolbar
  --
  -- The control row above the render surface: an in-page find, the annotation-tool switches (select, text, draw,
  -- highlight) with a params caret, an editable page indicator, zoom step/preset controls, and an overflow menu (rotate,
  -- first/last page, print). Identity -- the file name, save state, and Save -- lives in the layout header (the PDF
  -- identity bar). A read-only session (a viewer) drops the annotation tools and the params caret but keeps find, the
  -- page indicator, zoom, and the overflow menu, since viewing controls harm nothing. It reads and drives the annotator
  -- store.
  --------------------------------------------------------------------------------------------------------------------->

<template>
    <div class="flex flex-wrap items-center gap-3 border-b border-default px-4 py-2">
        <PdfFindBar v-if="store.findOpen" class="w-full sm:w-auto" />
        <UButton
            v-else
            icon="i-lucide-search"
            color="neutral"
            variant="ghost"
            size="sm"
            aria-label="Find in document"
            @click="store.openFind()"
        />

        <UFieldGroup v-if="!store.readOnly">
            <UButton
                v-for="tool in tools"
                :key="tool.mode"
                :icon="tool.icon"
                :aria-label="tool.label"
                :variant="store.mode === tool.mode ? 'solid' : 'outline'"
                color="neutral"
                size="sm"
                @click="store.setMode(tool.mode)"
            />
            <UPopover>
                <UButton
                    icon="i-lucide-chevron-down"
                    :disabled="store.mode === 'none'"
                    variant="outline"
                    color="neutral"
                    size="sm"
                    aria-label="Tool options"
                />
                <template #content>
                    <PdfParamsPopover :mode="store.mode" />
                </template>
            </UPopover>
        </UFieldGroup>

        <div v-if="store.pageCount > 0" class="flex items-center gap-1 text-sm text-dimmed tabular-nums">
            <UInput
                :model-value="pageDraft"
                aria-label="Page number"
                size="sm"
                :ui="{ base: 'w-12 text-center' }"
                @update:model-value="pageDraft = String($event)"
                @keydown.enter="commitPage"
                @blur="commitPage"
            />
            <span>/ {{ store.pageCount }}</span>
        </div>

        <UFieldGroup>
            <UButton
                icon="i-lucide-zoom-out"
                color="neutral"
                variant="subtle"
                size="sm"
                aria-label="Zoom out"
                @click="store.zoomOut()"
            />
            <USelectMenu
                :model-value="store.zoom"
                value-key="value"
                :items="zoomPresets"
                :search-input="false"
                size="sm"
                color="neutral"
                variant="subtle"
                :ui="{ content: 'w-40' }"
                @update:model-value="store.setZoom"
            />
            <UButton
                icon="i-lucide-zoom-in"
                color="neutral"
                variant="subtle"
                size="sm"
                aria-label="Zoom in"
                @click="store.zoomIn()"
            />
        </UFieldGroup>

        <UDropdownMenu :items="overflowItems">
            <UButton
                icon="i-lucide-ellipsis-vertical"
                color="neutral"
                variant="ghost"
                size="sm"
                aria-label="More actions"
            />
        </UDropdownMenu>
    </div>
</template>

<!--------------------------------------------------------------------------------------------------------------------->

<script setup lang="ts">
    import { computed, ref, watch } from 'vue';
    import type { DropdownMenuItem } from '@nuxt/ui';

    // Resource Access
    import { downloadUrl } from '../../../resource-access/downloads.ts';

    // Stores
    import { usePdfAnnotatorStore } from '../../../stores/pdfAnnotator.ts';

    // Components
    import { type AnnotationMode, zoomPresets } from './types.ts';
    import PdfFindBar from './findBar.vue';
    import PdfParamsPopover from './paramsPopover.vue';

    //------------------------------------------------------------------------------------------------------------------

    // The registered name stays descriptive though the file is just the handler namespace's `toolbar`.
    defineOptions({ name: 'PdfToolbar' });

    const store = usePdfAnnotatorStore();

    const tools : readonly { mode : AnnotationMode; icon : string; label : string }[]
        = [
            { mode: 'none', icon: 'i-lucide-mouse-pointer-2', label: 'Select' },
            { mode: 'freetext', icon: 'i-lucide-type', label: 'Add text' },
            { mode: 'ink', icon: 'i-lucide-pen-line', label: 'Draw' },
            { mode: 'highlight', icon: 'i-lucide-highlighter', label: 'Highlight' },
        ];

    //------------------------------------------------------------------------------------------------------------------
    // Page jump
    //------------------------------------------------------------------------------------------------------------------

    // The page box is an editable draft that tracks the scrolled-to page until the user types; committing clamps the
    // parse through the store and snaps the draft back to the accepted page.
    const pageDraft = ref(String(store.currentPage));
    watch(() => store.currentPage, (page) => { pageDraft.value = String(page); });

    function commitPage() : void
    {
        const parsed = Number.parseInt(pageDraft.value, 10);
        if(Number.isFinite(parsed)) { store.goToPage(parsed); }
        pageDraft.value = String(store.currentPage);
    }

    //------------------------------------------------------------------------------------------------------------------
    // Overflow menu
    //------------------------------------------------------------------------------------------------------------------

    // Print is pragmatic v1: open the file's inline URL in a new tab and let the browser's own PDF viewer print. The
    // annotator's unsaved marks are not in that stream -- printing reflects what is saved on the server.
    function print() : void
    {
        const current = store.node;
        if(current === null) { return; }

        window.open(downloadUrl(current.id, 'inline'), '_blank', 'noopener');
    }

    const overflowItems = computed<DropdownMenuItem[][]>(() =>
    {
        return [
            [
                { label: 'Rotate right', icon: 'i-lucide-rotate-cw', onSelect: () => { store.rotateCW(); } },
                { label: 'Rotate left', icon: 'i-lucide-rotate-ccw', onSelect: () => { store.rotateCCW(); } },
            ],
            [
                { label: 'First page', icon: 'i-lucide-chevrons-left', onSelect: () => { store.firstPage(); } },
                { label: 'Last page', icon: 'i-lucide-chevrons-right', onSelect: () => { store.lastPage(); } },
            ],
            [
                { label: 'Print (opens in new tab)', icon: 'i-lucide-printer', onSelect: print },
            ],
        ];
    });
</script>

<!--------------------------------------------------------------------------------------------------------------------->
