<!----------------------------------------------------------------------------------------------------------------------
  -- PDF Page Controls
  --
  -- Step a page at a time, or type one. The box is an editable draft that tracks the scrolled-to page until the reader
  -- types into it; committing clamps the parse through the store and snaps the draft back to the accepted page.
  --------------------------------------------------------------------------------------------------------------------->

<template>
    <div v-if="store.pageCount > 0" class="flex items-center gap-1">
        <UButton
            icon="i-lucide-chevron-up"
            color="neutral"
            variant="ghost"
            size="sm"
            aria-label="Previous page"
            :disabled="store.currentPage <= 1"
            @click="store.prevPage()"
        />
        <UButton
            icon="i-lucide-chevron-down"
            color="neutral"
            variant="ghost"
            size="sm"
            aria-label="Next page"
            :disabled="store.currentPage >= store.pageCount"
            @click="store.nextPage()"
        />

        <UInput
            :model-value="draft"
            aria-label="Page number"
            size="sm"
            inputmode="numeric"
            :ui="{ base: 'w-12 text-center' }"
            @update:model-value="draft = String($event)"
            @keydown.enter="commit"
            @blur="commit"
        />
        <span class="text-sm text-dimmed tabular-nums">/ {{ store.pageCount }}</span>
    </div>
</template>

<!--------------------------------------------------------------------------------------------------------------------->

<script setup lang="ts">
    import { ref, watch } from 'vue';

    // Stores
    import { usePdfAnnotatorStore } from '../../../stores/pdfAnnotator.ts';

    //------------------------------------------------------------------------------------------------------------------

    defineOptions({ name: 'PdfPageControls' });

    const store = usePdfAnnotatorStore();

    const draft = ref(String(store.currentPage));
    watch(() => store.currentPage, (page) => { draft.value = String(page); });

    function commit() : void
    {
        const parsed = Number.parseInt(draft.value, 10);
        if(Number.isFinite(parsed)) { store.goToPage(parsed); }
        draft.value = String(store.currentPage);
    }
</script>

<!--------------------------------------------------------------------------------------------------------------------->
