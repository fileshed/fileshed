<!----------------------------------------------------------------------------------------------------------------------
  -- PDF Find Bar
  --
  -- The in-page search strip: a query box, the four search toggles, the "x of y" match tally, previous/next walkers,
  -- and a close button. It reads and drives the annotator store, which owns the query, the toggles, the tally, and the
  -- search commands the render surface carries to pdf.js's find controller. Typing searches as you go; Enter and the
  -- walkers step through matches; Escape closes. Opened focused, so the caller's Cmd/Ctrl+F lands the cursor in the box.
  --
  -- Shift+Enter walks backwards, which is the binding every find box in every browser has taught people to expect.
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
            class="min-w-0 flex-1 bg-transparent px-1 text-sm outline-none placeholder:text-dimmed sm:w-40
                sm:flex-none"
            @input="onInput"
            @keydown.enter.exact.prevent="store.findNext()"
            @keydown.enter.shift.prevent="store.findPrev()"
            @keydown.esc.prevent="store.closeFind()"
        >

        <span v-if="store.findQuery.trim() !== ''" class="shrink-0 px-1 text-xs tabular-nums text-dimmed">
            {{ store.findTotal > 0 ? `${ store.findCurrent } of ${ store.findTotal }` : 'No results' }}
        </span>

        <UButton
            v-for="toggle in toggles"
            :key="toggle.option"
            :icon="toggle.icon"
            :variant="store.findOptions[toggle.option] ? 'solid' : 'ghost'"
            color="neutral"
            size="xs"
            :aria-label="toggle.label"
            :aria-pressed="store.findOptions[toggle.option]"
            :title="toggle.label"
            @click="store.toggleFindOption(toggle.option)"
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

    // Components
    import type { FindOptions } from './types.ts';

    //------------------------------------------------------------------------------------------------------------------

    defineOptions({ name: 'PdfFindBar' });

    const store = usePdfAnnotatorStore();

    const input = ref<HTMLInputElement | null>(null);

    const toggles : readonly { option : keyof FindOptions; icon : string; label : string }[]
        = [
            { option: 'highlightAll', icon: 'i-lucide-highlighter', label: 'Highlight all' },
            { option: 'caseSensitive', icon: 'i-lucide-case-sensitive', label: 'Match case' },
            { option: 'entireWord', icon: 'i-lucide-whole-word', label: 'Whole words' },
            { option: 'matchDiacritics', icon: 'i-lucide-a-large-small', label: 'Match diacritics' },
        ];

    //------------------------------------------------------------------------------------------------------------------

    function onInput(event : Event) : void
    {
        store.setFindQuery((event.target as HTMLInputElement).value);
    }

    onMounted(() => { input.value?.focus(); });
</script>

<!--------------------------------------------------------------------------------------------------------------------->
