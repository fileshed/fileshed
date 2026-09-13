<!----------------------------------------------------------------------------------------------------------------------
  -- PDF Zoom Controls
  --------------------------------------------------------------------------------------------------------------------->

<template>
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
</template>

<!--------------------------------------------------------------------------------------------------------------------->

<script setup lang="ts">
    // Stores
    import { usePdfAnnotatorStore } from '../../../stores/pdfAnnotator.ts';

    // Components
    import { zoomPresets } from './types.ts';

    //------------------------------------------------------------------------------------------------------------------

    defineOptions({ name: 'PdfZoomControls' });

    const store = usePdfAnnotatorStore();
</script>

<!--------------------------------------------------------------------------------------------------------------------->
