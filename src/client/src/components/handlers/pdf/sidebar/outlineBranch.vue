<!----------------------------------------------------------------------------------------------------------------------
  -- PDF Outline Branch
  --
  -- Recursive: an outline nests arbitrarily, so a branch renders itself for each child. An entry with no destination
  -- is a heading -- it expands, but there is nowhere to go.
  --------------------------------------------------------------------------------------------------------------------->

<template>
    <li>
        <div class="flex items-center gap-0.5">
            <UButton
                v-if="entry.items.length > 0"
                :icon="expanded ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'"
                :aria-label="expanded ? `Collapse ${ title }` : `Expand ${ title }`"
                color="neutral"
                variant="ghost"
                size="xs"
                class="shrink-0"
                @click="expanded = !expanded"
            />
            <span v-else class="size-6 shrink-0" />

            <button
                type="button"
                class="min-w-0 flex-1 truncate rounded-sm px-1 py-1 text-left text-sm enabled:hover:bg-elevated/50
                    disabled:text-dimmed"
                :class="{ 'font-semibold': entry.bold, 'italic': entry.italic }"
                :disabled="entry.dest === null"
                :title="title"
                @click="go"
            >
                {{ title }}
            </button>
        </div>

        <ul v-if="expanded && entry.items.length > 0" class="ml-3 border-l border-default pl-1">
            <PdfOutlineBranch v-for="child in entry.items" :key="child.id" :entry="child" />
        </ul>
    </li>
</template>

<!--------------------------------------------------------------------------------------------------------------------->

<script setup lang="ts">
    import { computed, ref } from 'vue';

    // Stores
    import { usePdfAnnotatorStore } from '../../../../stores/pdfAnnotator.ts';

    // Components
    import type { OutlineEntry } from '../types.ts';

    //------------------------------------------------------------------------------------------------------------------

    defineOptions({ name: 'PdfOutlineBranch' });

    const props = defineProps<{
        entry : OutlineEntry;
    }>();

    const store = usePdfAnnotatorStore();

    // Outlines in the wild carry blank titles; a row with no label is unclickable and looks broken.
    const title = computed(() =>
    {
        return props.entry.title === '' ? 'Untitled' : props.entry.title;
    });

    // Open to the first level so an outline shows its structure on arrival, closed below it so a deep one does not
    // arrive as a wall of text.
    const expanded = ref(props.entry.id.indexOf('.') === -1);

    function go() : void
    {
        if(props.entry.dest !== null) { store.goToDestination(props.entry.dest); }
    }
</script>

<!--------------------------------------------------------------------------------------------------------------------->
