<!----------------------------------------------------------------------------------------------------------------------
  -- Node List
  --
  -- The dense drive surface: a sortable table of rows. Clicking a column header emits its sort key; the view decides
  -- the direction and drives the store. Selection and open intents relay up from the rows unchanged. Owner is a
  -- plain header cell, not a sort button -- the listing API has no owner sort key.
  --------------------------------------------------------------------------------------------------------------------->

<template>
    <div>
        <div
            class="grid grid-cols-[minmax(0,1fr)_2.5rem_2.5rem]
                sm:grid-cols-[minmax(0,1fr)_2.5rem_9rem_2.5rem]
                lg:grid-cols-[minmax(0,1fr)_2.5rem_7rem_9rem_2.5rem]
                xl:grid-cols-[minmax(0,1fr)_2.5rem_7rem_9rem_6rem_2.5rem] gap-2 border-b border-default px-3 pb-2
                text-xs font-semibold text-muted sm:gap-4"
        >
            <button type="button" class="flex items-center gap-1 text-left hover:text-default" @click="emit('sort', 'name')">
                Name
                <UIcon v-if="sortKey === 'name'" :name="directionIcon" class="size-3.5" />
            </button>
            <span class="text-center">Owner</span>
            <button
                type="button"
                class="hidden items-center gap-1 text-left hover:text-default lg:flex"
                @click="emit('sort', 'size')"
            >
                Size
                <UIcon v-if="sortKey === 'size'" :name="directionIcon" class="size-3.5" />
            </button>
            <button
                type="button"
                class="hidden items-center gap-1 text-left hover:text-default sm:flex"
                @click="emit('sort', 'updatedAt')"
            >
                Modified
                <UIcon v-if="sortKey === 'updatedAt'" :name="directionIcon" class="size-3.5" />
            </button>
            <button
                type="button"
                class="hidden items-center gap-1 text-left hover:text-default xl:flex"
                @click="emit('sort', 'kind')"
            >
                Type
                <UIcon v-if="sortKey === 'kind'" :name="directionIcon" class="size-3.5" />
            </button>
        </div>

        <NodeRow
            v-for="node in nodes"
            :key="node.id"
            :node="node"
            :selected="selection.has(node.id)"
            :menu-items="buildMenu(node)"
            :owners="owners"
            @select="(n, event) => emit('select', n, event)"
            @open="(n) => emit('open', n)"
        />
    </div>
</template>

<!--------------------------------------------------------------------------------------------------------------------->

<script setup lang="ts">
    import { computed } from 'vue';
    import type { ContextMenuItem } from '@nuxt/ui';

    import type { NodeResponse, NodeSortKey, SortDirection, UserSummary } from '@fileshed/core';

    // Components
    import NodeRow from './nodeRow.vue';

    //------------------------------------------------------------------------------------------------------------------

    const props = defineProps<{
        nodes : NodeResponse[];
        selection : ReadonlySet<string>;
        sortKey : NodeSortKey;
        sortDirection : SortDirection;
        buildMenu : (node : NodeResponse) => ContextMenuItem[][];
        owners : UserSummary[];
    }>();

    const emit = defineEmits<{
        select : [ node : NodeResponse, event : MouseEvent ];
        open : [ node : NodeResponse ];
        sort : [ key : NodeSortKey ];
    }>();

    //------------------------------------------------------------------------------------------------------------------

    const directionIcon = computed(() =>
    {
        return props.sortDirection === 'asc' ? 'i-lucide-arrow-up' : 'i-lucide-arrow-down';
    });
</script>

<!--------------------------------------------------------------------------------------------------------------------->
