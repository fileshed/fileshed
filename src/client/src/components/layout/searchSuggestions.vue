<!----------------------------------------------------------------------------------------------------------------------
  -- Search Suggestions
  --
  -- The dropdown under the top bar's search box: a handful of matching files and folders, each with where it lives, and
  -- a last row that runs the full search. Purely presentational -- the box owns which row is active and what picking
  -- one does.
  --
  -- Rows commit on mousedown rather than click: a click would blur the input first, closing the dropdown out from under
  -- the pointer before the row ever fired.
  --------------------------------------------------------------------------------------------------------------------->

<template>
    <div
        class="absolute inset-x-0 top-full z-50 mt-1 overflow-hidden rounded-md border border-default bg-default
            shadow-lg"
    >
        <p v-if="rows.length === 0" class="px-3 py-2 text-sm text-dimmed">
            {{ loading ? 'Searching…' : `No matches for "${ term }"` }}
        </p>

        <ul v-else class="max-h-80 overflow-y-auto py-1" role="listbox" aria-label="Search suggestions">
            <li v-for="(row, index) in rows" :key="row.node.id">
                <button
                    type="button"
                    class="flex w-full min-w-0 items-center gap-2 px-3 py-1.5 text-left"
                    :class="index === activeIndex ? 'bg-elevated' : 'hover:bg-elevated/50'"
                    role="option"
                    :aria-selected="index === activeIndex"
                    @mousedown.prevent="emit('pick', index)"
                    @mouseenter="emit('hover', index)"
                >
                    <UIcon
                        :name="row.presentation.icon"
                        class="size-4 shrink-0"
                        :class="row.presentation.color"
                    />

                    <span class="flex min-w-0 flex-col">
                        <span class="truncate text-sm">{{ row.node.name }}</span>
                        <LocationLine v-if="row.location" :location="row.location" :root-label="rootLabel" />
                    </span>
                </button>
            </li>
        </ul>

        <button
            type="button"
            class="flex w-full items-center gap-2 border-t border-default px-3 py-2 text-left text-sm text-muted"
            :class="activeIndex === rows.length ? 'bg-elevated' : 'hover:bg-elevated/50'"
            @mousedown.prevent="emit('pick', rows.length)"
            @mouseenter="emit('hover', rows.length)"
        >
            <UIcon name="i-lucide-search" class="size-4 shrink-0" />
            See all results for "{{ term }}"
        </button>
    </div>
</template>

<!--------------------------------------------------------------------------------------------------------------------->

<script setup lang="ts">
    import { computed } from 'vue';

    import type { NodeLocation, NodeResponse } from '@fileshed/core';

    // Components
    import LocationLine from '../search/locationLine.vue';

    // Utils
    import { type NodeTypePresentation, nodePresentation } from '../../utils/formatters/index.ts';

    //------------------------------------------------------------------------------------------------------------------

    const props = defineProps<{
        nodes : NodeResponse[];
        locations : Record<string, NodeLocation>;
        rootLabel : string;
        term : string;
        loading : boolean;
        activeIndex : number;
    }>();

    const emit = defineEmits<{
        pick : [ index : number ];
        hover : [ index : number ];
    }>();

    interface SuggestionRow
    {
        node : NodeResponse;
        location : NodeLocation | null;
        presentation : NodeTypePresentation;
    }

    const rows = computed<SuggestionRow[]>(() => props.nodes.map((node) => ({
        node,
        location: props.locations[node.id] ?? null,
        presentation: nodePresentation(node),
    })));
</script>

<!--------------------------------------------------------------------------------------------------------------------->
