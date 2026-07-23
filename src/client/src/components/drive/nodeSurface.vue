<!----------------------------------------------------------------------------------------------------------------------
  -- Node Surface
  --
  -- The switching body of the drive: the loading spinner, the load error with its retry, the two empty states (filtered
  -- to nothing vs. a genuinely empty folder), and otherwise the grid or list of nodes with a Load more when the folder
  -- is paged. Reads the store for the listing state directly; selection intents and the list-header sort relay up, and
  -- a click on the surface's own empty space clears the selection.
  --------------------------------------------------------------------------------------------------------------------->

<template>
    <div class="min-h-0 flex-1" @click.self="emit('clear-empty')">
        <div v-if="store.loading" class="flex h-64 items-center justify-center text-muted">
            <UIcon name="i-lucide-loader-circle" class="size-6 animate-spin" />
        </div>

        <div
            v-else-if="store.error"
            class="flex h-64 flex-col items-center justify-center gap-3 text-center text-muted"
        >
            <UIcon name="i-lucide-triangle-alert" class="size-8 text-warning" />
            <p>We couldn't load this folder.</p>
            <UButton color="neutral" variant="subtle" label="Retry" @click="retry" />
        </div>

        <div
            v-else-if="store.filteredEmpty"
            class="flex h-64 flex-col items-center justify-center gap-3 text-center text-dimmed"
        >
            <UIcon name="i-lucide-filter-x" class="size-10" />
            <p>No items match these filters.</p>
            <UButton color="neutral" variant="subtle" label="Clear filters" @click="store.clearFilters()" />
        </div>

        <div
            v-else-if="store.isEmpty"
            class="flex h-64 flex-col items-center justify-center gap-3 text-center text-dimmed"
        >
            <UIcon name="i-lucide-folder-open" class="size-10" />
            <p>This folder is empty.</p>
        </div>

        <template v-else>
            <NodeGrid
                v-if="viewMode === 'grid'"
                :nodes="store.children"
                :selection="selection"
                :build-menu="buildMenu"
                @select="(node, event) => emit('select', node, event)"
                @open="(node) => emit('open', node)"
            />
            <NodeList
                v-else
                :nodes="store.children"
                :selection="selection"
                :sort-key="store.sortKey"
                :sort-direction="store.sortDirection"
                :build-menu="buildMenu"
                :owners="store.owners"
                @select="(node, event) => emit('select', node, event)"
                @open="(node) => emit('open', node)"
                @sort="(key) => emit('sort', key)"
            />

            <div v-if="store.hasMore" class="mt-4 flex justify-center">
                <UButton
                    color="neutral"
                    variant="subtle"
                    label="Load more"
                    :loading="store.loadingMore"
                    @click="store.loadMore"
                />
            </div>
        </template>
    </div>
</template>

<!--------------------------------------------------------------------------------------------------------------------->

<script setup lang="ts">
    import type { ContextMenuItem } from '@nuxt/ui';

    import type { NodeResponse, NodeSortKey, ViewMode } from '@fileshed/core';

    // Stores
    import { useDriveStore } from '../../stores/drive.ts';

    // Components
    import NodeGrid from './nodeGrid.vue';
    import NodeList from './nodeList.vue';

    //------------------------------------------------------------------------------------------------------------------

    defineProps<{
        viewMode : ViewMode;
        selection : ReadonlySet<string>;
        buildMenu : (node : NodeResponse) => ContextMenuItem[][];
    }>();

    const emit = defineEmits<{
        'select' : [ node : NodeResponse, event : MouseEvent ];
        'open' : [ node : NodeResponse ];
        'sort' : [ key : NodeSortKey ];
        'clear-empty' : [];
    }>();

    //------------------------------------------------------------------------------------------------------------------

    const store = useDriveStore();

    function retry() : void
    {
        void store.load(store.folderID);
    }
</script>

<!--------------------------------------------------------------------------------------------------------------------->
