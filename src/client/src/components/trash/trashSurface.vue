<!----------------------------------------------------------------------------------------------------------------------
  -- Trash Surface
  --
  -- The body of the Trash view: the loading spinner, the load error with its retry, the "Trash is empty" state, the
  -- filtered-to-nothing state, and otherwise the caller's trashed roots as a grid of cards or a dense row list, per the
  -- view toggle. Each item carries Restore and Delete forever behind a kebab; the actions relay up so the page owns
  -- restore (a direct mutation) and Delete forever (a confirm modal). Reads the trash store for its listing state
  -- directly, and tells it how far the rendering has reached so a listing past the ceiling keeps loading as it scrolls.
  --------------------------------------------------------------------------------------------------------------------->

<template>
    <div class="flex min-h-0 flex-1 flex-col gap-3 select-none">
        <div v-if="store.loading" class="flex h-64 items-center justify-center text-muted">
            <UIcon name="i-lucide-loader-circle" class="size-6 animate-spin" />
        </div>

        <div
            v-else-if="store.error"
            class="flex h-64 flex-col items-center justify-center gap-3 text-center text-muted"
        >
            <UIcon name="i-lucide-triangle-alert" class="size-8 text-warning" />
            <p>We couldn't load your trash.</p>
            <UButton color="neutral" variant="subtle" label="Retry" @click="store.load()" />
        </div>

        <div
            v-else-if="store.filteredEmpty"
            class="flex h-64 flex-col items-center justify-center gap-3 text-center text-dimmed"
        >
            <UIcon name="i-lucide-filter-x" class="size-10" />
            <p>No trashed items match these filters.</p>
            <UButton color="neutral" variant="subtle" label="Clear filters" @click="store.clearFilters()" />
        </div>

        <div
            v-else-if="store.isEmpty"
            class="flex h-64 flex-col items-center justify-center gap-3 text-center text-dimmed"
        >
            <UIcon name="i-lucide-trash-2" class="size-10" />
            <p>Trash is empty.</p>
        </div>

        <template v-else>
            <CappedNotice v-if="store.capped" class="shrink-0" subject="trash" />

            <VirtualScroller
                v-if="viewMode === 'grid'"
                class="min-h-0 flex-1"
                :items="store.items"
                :item-height="LISTING_TILE_HEIGHT"
                :columns="columns"
                :gap="LISTING_GRID_GAP"
                @reached="store.reachedIndex"
            >
                <template #default="{ item } : { item : NodeResponse }">
                    <TrashTile :node="item" :menu-items="menuFor(item)" />
                </template>
            </VirtualScroller>

            <VirtualScroller
                v-else
                class="min-h-0 flex-1"
                :items="store.items"
                :item-height="rowHeight"
                @reached="store.reachedIndex"
            >
                <template #default="{ item } : { item : NodeResponse }">
                    <div
                        :aria-label="item.name"
                        class="flex h-14 items-center gap-3 border-b border-default px-3 text-sm sm:h-12"
                    >
                        <UIcon
                            :name="presentationOf(item).icon"
                            class="size-5 shrink-0"
                            :class="presentationOf(item).color"
                        />
                        <span class="min-w-0 flex-1 truncate font-medium" :title="item.name">{{ item.name }}</span>
                        <span class="hidden w-24 shrink-0 truncate text-right text-muted sm:block">
                            {{ sizeOf(item) }}
                        </span>

                        <UDropdownMenu :items="menuFor(item)" :ui="{ content: 'w-48' }">
                            <UButton
                                icon="i-lucide-ellipsis-vertical"
                                color="neutral"
                                variant="ghost"
                                size="sm"
                                aria-label="More actions"
                            />
                        </UDropdownMenu>
                    </div>
                </template>
            </VirtualScroller>
        </template>
    </div>
</template>

<!--------------------------------------------------------------------------------------------------------------------->

<script setup lang="ts">
    import type { DropdownMenuItem } from '@nuxt/ui';

    import { LISTING_GRID_GAP, LISTING_TILE_HEIGHT, type NodeResponse, type ViewMode } from '@fileshed/core';

    // Stores
    import { useTrashStore } from '../../stores/trash.ts';

    // Components
    import TrashTile from './trashTile.vue';
    import CappedNotice from '../listing/cappedNotice.vue';
    import VirtualScroller from '../listing/virtualScroller.vue';

    // Resource Access
    import { useListingMetrics } from '../../resource-access/listingMetrics.ts';

    // Utils
    import { type NodeTypePresentation, formatBytes, nodePresentation } from '../../utils/formatters/index.ts';

    //------------------------------------------------------------------------------------------------------------------

    defineProps<{
        viewMode : ViewMode;
    }>();

    const emit = defineEmits<{
        restore : [ node : NodeResponse ];
        delete : [ node : NodeResponse ];
    }>();

    const store = useTrashStore();
    const { columns, rowHeight } = useListingMetrics();

    function presentationOf(node : NodeResponse) : NodeTypePresentation
    {
        return nodePresentation(node);
    }

    function sizeOf(node : NodeResponse) : string
    {
        return node.type === 'file' ? formatBytes(node.size) : '—';
    }

    // One menu for both renderings -- the tile's corner kebab and the row's end kebab offer the same two actions, and
    // both relay up so the page keeps ownership of restore and the delete confirm.
    function menuFor(node : NodeResponse) : DropdownMenuItem[][]
    {
        return [
            [ { label: 'Restore', icon: 'i-lucide-rotate-ccw', onSelect: () => emit('restore', node) } ],
            [ {
                label: 'Delete forever',
                icon: 'i-lucide-trash-2',
                color: 'error',
                onSelect: () => emit('delete', node),
            } ],
        ];
    }
</script>

<!--------------------------------------------------------------------------------------------------------------------->
