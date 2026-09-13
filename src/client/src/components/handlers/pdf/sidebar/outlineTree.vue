<!----------------------------------------------------------------------------------------------------------------------
  -- PDF Outline Tree
  --------------------------------------------------------------------------------------------------------------------->

<template>
    <ul v-if="store.outline.length > 0" class="p-2">
        <PdfOutlineBranch v-for="entry in store.outline" :key="entry.id" :entry="entry" />
    </ul>

    <p v-else class="p-4 text-center text-sm text-dimmed">
        This document has no outline.
    </p>
</template>

<!--------------------------------------------------------------------------------------------------------------------->

<script setup lang="ts">
    // Stores
    import { usePdfAnnotatorStore } from '../../../../stores/pdfAnnotator.ts';

    // Components
    import PdfOutlineBranch from './outlineBranch.vue';

    //------------------------------------------------------------------------------------------------------------------

    defineOptions({ name: 'PdfOutlineTree' });

    const store = usePdfAnnotatorStore();
</script>

<!--------------------------------------------------------------------------------------------------------------------->
