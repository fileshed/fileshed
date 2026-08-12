<!----------------------------------------------------------------------------------------------------------------------
  -- Shared Surface
  --
  -- The body of the Shared with me view: the loading spinner, the load error with its retry, the "nothing shared yet"
  -- empty state, the filtered-to-nothing state, and otherwise the caller's incoming grants as a grid of cards or a dense
  -- row list, per the view toggle. Each item shows the target, the owner's avatar and name, the caller's role, and
  -- whether it is already placed in their files; a double-click opens it and a kebab offers the recipient actions the
  -- page builds. Reads the shared store for its listing state directly; open and the per-row menu relay up.
  --
  -- The listing is one unpaginated read, so every grant is here at once and only the ones in view are mounted.
  --------------------------------------------------------------------------------------------------------------------->

<template>
    <div class="flex min-h-0 flex-1 flex-col select-none">
        <div v-if="store.loading" class="flex h-64 items-center justify-center text-muted">
            <UIcon name="i-lucide-loader-circle" class="size-6 animate-spin" />
        </div>

        <div
            v-else-if="store.error"
            class="flex h-64 flex-col items-center justify-center gap-3 text-center text-muted"
        >
            <UIcon name="i-lucide-triangle-alert" class="size-8 text-warning" />
            <p>We couldn't load your shared items.</p>
            <UButton color="neutral" variant="subtle" label="Retry" @click="store.load()" />
        </div>

        <div
            v-else-if="store.filteredEmpty"
            class="flex h-64 flex-col items-center justify-center gap-3 text-center text-dimmed"
        >
            <UIcon name="i-lucide-filter-x" class="size-10" />
            <p>No shared items match these filters.</p>
            <UButton color="neutral" variant="subtle" label="Clear filters" @click="store.clearFilters()" />
        </div>

        <div
            v-else-if="store.isEmpty"
            class="flex h-64 flex-col items-center justify-center gap-3 text-center text-dimmed"
        >
            <UIcon name="i-lucide-users" class="size-10" />
            <p>Nothing has been shared with you yet.</p>
        </div>

        <VirtualScroller
            v-else-if="viewMode === 'grid'"
            class="min-h-0 flex-1"
            :items="store.entries"
            :item-height="LISTING_SHARED_TILE_HEIGHT"
            :columns="columns"
            :gap="LISTING_GRID_GAP"
            :item-key="(entry : SharedWithMeEntry) => entry.share.id"
        >
            <template #default="{ item } : { item : SharedWithMeEntry }">
                <SharedTile :entry="item" :build-menu="buildMenu" @open="(e) => emit('open', e)" />
            </template>
        </VirtualScroller>

        <VirtualScroller
            v-else
            class="min-h-0 flex-1"
            :items="store.entries"
            :item-height="LISTING_ROW_HEIGHT_STACKED"
            :item-key="(entry : SharedWithMeEntry) => entry.share.id"
        >
            <template #default="{ item } : { item : SharedWithMeEntry }">
                <div
                    :aria-label="item.target.name"
                    class="flex h-14 items-center gap-3 border-b border-default px-3 text-sm"
                    @dblclick="emit('open', item)"
                >
                    <UIcon
                        :name="presentationOf(item).icon"
                        class="size-5 shrink-0"
                        :class="presentationOf(item).color"
                    />

                    <div class="min-w-0 flex-1">
                        <p class="truncate font-medium" :title="item.target.name">
                            {{ item.target.name }}
                        </p>
                        <p class="flex items-center gap-1 truncate text-xs text-muted">
                            <UAvatar :src="item.owner.image ?? undefined" :alt="item.owner.name" size="2xs" />
                            <span class="truncate">Shared by {{ item.owner.name }}</span>
                        </p>
                    </div>

                    <UBadge
                        color="neutral"
                        variant="subtle"
                        size="sm"
                        class="hidden shrink-0 capitalize lg:inline-flex"
                    >
                        {{ item.share.role }}
                    </UBadge>
                    <span v-if="item.placed" class="hidden shrink-0 text-xs text-muted lg:inline">In your files</span>

                    <span class="hidden w-24 shrink-0 truncate text-right text-muted sm:block">
                        {{ sizeOf(item) }}
                    </span>

                    <UDropdownMenu :items="buildMenu(item)">
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
    </div>
</template>

<!--------------------------------------------------------------------------------------------------------------------->

<script setup lang="ts">
    import type { DropdownMenuItem } from '@nuxt/ui';

    import {
        LISTING_GRID_GAP,
        LISTING_ROW_HEIGHT_STACKED,
        LISTING_SHARED_TILE_HEIGHT,
        type SharedWithMeEntry,
        type ViewMode,
    } from '@fileshed/core';

    // Stores
    import { useSharedStore } from '../../stores/shared.ts';

    // Components
    import SharedTile from './sharedTile.vue';
    import VirtualScroller from '../listing/virtualScroller.vue';

    // Resource Access
    import { useListingMetrics } from '../../resource-access/listingMetrics.ts';

    // Utils
    import { type NodeTypePresentation, formatBytes, sharedTargetPresentation } from '../../utils/formatters/index.ts';

    //------------------------------------------------------------------------------------------------------------------

    defineProps<{
        viewMode : ViewMode;
        buildMenu : (entry : SharedWithMeEntry) => DropdownMenuItem[][];
    }>();

    const emit = defineEmits<{
        open : [ entry : SharedWithMeEntry ];
    }>();

    // A shared row always stacks the owner's attribution under the name, so it takes the taller row at every width.
    const store = useSharedStore();
    const { columns } = useListingMetrics();

    function presentationOf(entry : SharedWithMeEntry) : NodeTypePresentation
    {
        return sharedTargetPresentation(entry.target);
    }

    function sizeOf(entry : SharedWithMeEntry) : string
    {
        return entry.target.type === 'file' && entry.target.size !== undefined ? formatBytes(entry.target.size) : '—';
    }
</script>

<!--------------------------------------------------------------------------------------------------------------------->
