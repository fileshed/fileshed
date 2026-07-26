<!----------------------------------------------------------------------------------------------------------------------
  -- PDF Find Bar
  --
  -- The in-page search strip: a query box, a case-sensitivity toggle, the "x of y" match tally, previous/next walkers,
  -- and a close button. It reads and drives the annotator store, which owns the query, the toggle, the tally, and the
  -- search commands the render surface carries to pdf.js's find controller. Typing searches as you go; Enter and the
  -- walkers step through matches; Escape closes. Opened focused, so the caller's Cmd/Ctrl+F lands the cursor in the box.
  --------------------------------------------------------------------------------------------------------------------->

<template>
    <div class="flex items-center gap-1 rounded-md border border-default bg-elevated/50 px-1.5 py-1">
        <UIcon name="i-lucide-search" class="size-4 shrink-0 text-dimmed" />

        <input
            ref="input"
            :value="store.findQuery"
            type="text"
            placeholder="Find in document"
            aria-label="Find in document"
            class="w-40 bg-transparent px-1 text-sm outline-none placeholder:text-dimmed"
            @input="onInput"
            @keydown.enter.prevent="onEnter"
            @keydown.esc.prevent="store.closeFind()"
        >

        <span v-if="store.findQuery.trim() !== ''" class="shrink-0 px-1 text-xs tabular-nums text-dimmed">
            {{ store.findTotal > 0 ? `${ store.findCurrent } of ${ store.findTotal }` : 'No results' }}
        </span>

        <UButton
            icon="i-lucide-case-sensitive"
            :variant="store.findCaseSensitive ? 'solid' : 'ghost'"
            color="neutral"
            size="xs"
            aria-label="Match case"
            @click="store.toggleFindCase()"
        />
        <UButton
            icon="i-lucide-chevron-up"
            variant="ghost"
            color="neutral"
            size="xs"
            aria-label="Previous match"
            @click="store.findPrev()"
        />
        <UButton
            icon="i-lucide-chevron-down"
            variant="ghost"
            color="neutral"
            size="xs"
            aria-label="Next match"
            @click="store.findNext()"
        />
        <UButton
            icon="i-lucide-x"
            variant="ghost"
            color="neutral"
            size="xs"
            aria-label="Close find"
            @click="store.closeFind()"
        />
    </div>
</template>

<!--------------------------------------------------------------------------------------------------------------------->

<script setup lang="ts">
    import { onMounted, ref } from 'vue';

    // Stores
    import { usePdfAnnotatorStore } from '../../../stores/pdfAnnotator.ts';

    //------------------------------------------------------------------------------------------------------------------

    defineOptions({ name: 'PdfFindBar' });

    const store = usePdfAnnotatorStore();

    const input = ref<HTMLInputElement | null>(null);

    //------------------------------------------------------------------------------------------------------------------

    function onInput(event : Event) : void
    {
        store.setFindQuery((event.target as HTMLInputElement).value);
    }

    function onEnter() : void
    {
        store.findNext();
    }

    onMounted(() => { input.value?.focus(); });
</script>

<!--------------------------------------------------------------------------------------------------------------------->
