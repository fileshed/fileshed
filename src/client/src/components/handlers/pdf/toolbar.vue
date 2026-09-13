<!----------------------------------------------------------------------------------------------------------------------
  -- PDF Annotator Toolbar
  --
  -- The control row above the render surface: the sidebar switch, an in-page find, the annotation tools with their
  -- params caret, undo and redo, page stepping, zoom, and the view menu. Identity -- the file name, save state, and
  -- Save -- lives in the layout header (the PDF identity bar).
  --
  -- A read-only session (a viewer) drops the annotation tools, the params caret, and the history controls, and keeps
  -- everything else: no viewing control harms anything.
  --------------------------------------------------------------------------------------------------------------------->

<template>
    <div class="flex flex-wrap items-center gap-2 border-b border-default px-3 py-2">
        <UButton
            icon="i-lucide-panel-left"
            color="neutral"
            :variant="store.sidebarOpen ? 'solid' : 'ghost'"
            size="sm"
            aria-label="Toggle sidebar"
            title="Toggle sidebar"
            @click="store.toggleSidebar()"
        />

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
                :title="tool.label"
                :variant="store.mode === tool.mode ? 'solid' : 'outline'"
                color="neutral"
                size="sm"
                @click="choose(tool.mode)"
            />
            <UPopover>
                <UButton
                    icon="i-lucide-chevron-down"
                    :disabled="!hasParams"
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

        <UFieldGroup v-if="!store.readOnly">
            <UButton
                icon="i-lucide-undo-2"
                color="neutral"
                variant="subtle"
                size="sm"
                aria-label="Undo"
                title="Undo"
                :disabled="!store.canUndo"
                @click="store.undo()"
            />
            <UButton
                icon="i-lucide-redo-2"
                color="neutral"
                variant="subtle"
                size="sm"
                aria-label="Redo"
                title="Redo"
                :disabled="!store.canRedo"
                @click="store.redo()"
            />
        </UFieldGroup>

        <PdfPageControls />

        <PdfZoomControls />

        <PdfViewMenu class="ml-auto" @present="emit('present')" />
    </div>
</template>

<!--------------------------------------------------------------------------------------------------------------------->

<script setup lang="ts">
    import { computed } from 'vue';

    // Stores
    import { usePdfAnnotatorStore } from '../../../stores/pdfAnnotator.ts';

    // Components
    import type { AnnotationMode } from './types.ts';
    import PdfFindBar from './findBar.vue';
    import PdfPageControls from './pageControls.vue';
    import PdfParamsPopover from './paramsPopover.vue';
    import PdfViewMenu from './viewMenu.vue';
    import PdfZoomControls from './zoomControls.vue';

    //------------------------------------------------------------------------------------------------------------------

    // The registered name stays descriptive though the file is just the handler namespace's `toolbar`.
    defineOptions({ name: 'PdfToolbar' });

    const emit = defineEmits<{
        present : [];
    }>();

    const store = usePdfAnnotatorStore();

    const tools : readonly { mode : AnnotationMode; icon : string; label : string }[]
        = [
            { mode: 'none', icon: 'i-lucide-mouse-pointer-2', label: 'Select' },
            { mode: 'freetext', icon: 'i-lucide-type', label: 'Add text' },
            { mode: 'ink', icon: 'i-lucide-pen-line', label: 'Draw' },
            { mode: 'highlight', icon: 'i-lucide-highlighter', label: 'Highlight' },
            { mode: 'stamp', icon: 'i-lucide-image', label: 'Add image' },
        ];

    // Stamp takes no settings -- it asks for an image and places it -- so the caret has nothing to open for it.
    const hasParams = computed(() => store.mode !== 'none' && store.mode !== 'stamp');

    // Every tool but the image is a mode the pointer then works in. The image is a command: pressing it asks for a
    // picture there and then, and pressing it again asks for another.
    function choose(next : AnnotationMode) : void
    {
        if(next === 'stamp') { store.addImage(); }
        else { store.setMode(next); }
    }
</script>

<!--------------------------------------------------------------------------------------------------------------------->
