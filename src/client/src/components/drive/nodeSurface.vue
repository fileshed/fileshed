<!----------------------------------------------------------------------------------------------------------------------
  -- Node Surface
  --
  -- The switching body of the drive: the loading spinner, the load error with its retry, the two empty states (filtered
  -- to nothing vs. a genuinely empty folder), and otherwise the grid or list of nodes. Reads the store for the listing
  -- state directly; selection intents and the list-header sort relay up, and a click that lands on empty space -- the
  -- surface's own padding or the scroller between items -- clears the selection.
  --
  -- The listing owns its scroll, so the header and the filter strip above it stay put however far down a folder the
  -- user is. How far the rendering has reached goes back to the store, which is what pulls the next chunk of a folder
  -- too big to hold whole.
  --
  -- One context menu serves the whole listing rather than one per row: a right-click names the node it landed on, and
  -- the menu is built for that node before the menu itself sees the event. A menu per row would be mounted and thrown
  -- away for every row that scrolls past, which is the most expensive thing a row could carry.
  --------------------------------------------------------------------------------------------------------------------->

<template>
    <div
        class="flex min-h-0 flex-1 flex-col gap-3 select-none"
        @click.self="emit('clear-empty')"
        @contextmenu.capture="onContextMenu"
    >
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
            <CappedNotice v-if="store.capped" class="shrink-0" subject="folder" />

            <UContextMenu :items="pointedMenu" :ui="{ content: 'w-48' }" class="min-h-0 flex-1">
                <NodeGrid
                    v-if="viewMode === 'grid'"
                    ref="grid"
                    :nodes="store.children"
                    :selection="selection"
                    :build-menu="buildMenu"
                    @select="(node, event) => emit('select', node, event)"
                    @open="(node) => emit('open', node)"
                    @reached="store.reachedIndex"
                    @clear-empty="emit('clear-empty')"
                />
                <NodeList
                    v-else
                    ref="list"
                    :nodes="store.children"
                    :selection="selection"
                    :sort-key="store.sortKey"
                    :sort-direction="store.sortDirection"
                    :build-menu="buildMenu"
                    :owners="store.owners"
                    @select="(node, event) => emit('select', node, event)"
                    @open="(node) => emit('open', node)"
                    @sort="(key) => emit('sort', key)"
                    @reached="store.reachedIndex"
                    @clear-empty="emit('clear-empty')"
                />
            </UContextMenu>
        </template>
    </div>
</template>

<!--------------------------------------------------------------------------------------------------------------------->

<script setup lang="ts">
    import { ref, useTemplateRef } from 'vue';
    import type { ContextMenuItem } from '@nuxt/ui';

    import type { NodeResponse, NodeSortKey, ViewMode } from '@fileshed/core';

    // Stores
    import { useDriveStore } from '../../stores/drive.ts';

    // Components
    import NodeGrid from './nodeGrid.vue';
    import NodeList from './nodeList.vue';
    import CappedNotice from '../listing/cappedNotice.vue';

    //------------------------------------------------------------------------------------------------------------------

    const props = defineProps<{
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

    const grid = useTemplateRef('grid');
    const list = useTemplateRef('list');

    // What the one context menu offers, rebuilt for whichever node the right-click landed on. Resolved in the capture
    // phase, so the menu below has the right items by the time the event reaches it.
    const pointedMenu = ref<ContextMenuItem[][]>([]);

    function onContextMenu(event : MouseEvent) : void
    {
        const target = event.target instanceof HTMLElement ? event.target.closest('[data-node-id]') : null;
        const nodeID = target?.getAttribute('data-node-id') ?? null;
        const node = nodeID === null ? null : store.children.find((child) => child.id === nodeID) ?? null;

        // A right-click on empty space has nothing to offer. Stopping it here keeps the listing's menu from opening
        // on nothing, and leaves the browser's own menu to it.
        if(node === null)
        {
            event.stopPropagation();
            return;
        }

        pointedMenu.value = props.buildMenu(node);
    }

    function retry() : void
    {
        void store.load(store.folderID);
    }

    // Bring a node into view by its place in the listing -- how the drive arrives pointing at the node a search result
    // sent it to, which with only the visible rows mounted has to scroll rather than simply mark it.
    function scrollToIndex(index : number) : void
    {
        const surface = grid.value ?? list.value;
        surface?.scrollToIndex(index);
    }

    defineExpose({ scrollToIndex });
</script>

<!--------------------------------------------------------------------------------------------------------------------->
