<!----------------------------------------------------------------------------------------------------------------------
  -- Filter Bar
  --
  -- The drive's idle bar, shown in the constant-height strip when nothing is selected: the shared Type and Modified
  -- chips, the drive-only Owner chip (single-select from the folder's own owners, self-hiding when the folder has a
  -- single owner), a Clear all chip when any filter is active, and -- in grid view -- the sort menu (list view sorts
  -- from its own column headers instead). Each chip drives the store, which reloads server-side. The strip's height
  -- lives on the drive page, so nothing here changes the row's height.
  --------------------------------------------------------------------------------------------------------------------->

<template>
    <div class="flex h-10 flex-1 items-center gap-2 overflow-x-auto">
        <TypeFilter :model-value="store.typeFamilies" @update:model-value="onPickTypes" />

        <!-- Owner -->
        <UPopover v-if="ownerChipVisible(store.owners)">
            <UButton
                size="sm"
                color="neutral"
                :variant="store.owner !== null ? 'solid' : 'subtle'"
                icon="i-lucide-user"
                trailing-icon="i-lucide-chevron-down"
                :label="ownerSummary === null ? 'Owner' : `Owner: ${ ownerSummary }`"
            />

            <template #content="{ close }">
                <div class="flex w-64 max-w-[calc(100vw-2rem)] flex-col p-1">
                    <button
                        type="button"
                        class="flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 hover:bg-elevated"
                        @click="pickOwner(null, close)"
                    >
                        <UIcon name="i-lucide-users" class="size-5 text-muted" />
                        <span class="flex-1 text-left text-sm">All owners</span>
                        <UIcon v-if="store.owner === null" name="i-lucide-check" class="size-4 text-primary" />
                    </button>

                    <button
                        v-for="entry in store.owners"
                        :key="entry.id"
                        type="button"
                        class="flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 hover:bg-elevated"
                        @click="pickOwner(entry, close)"
                    >
                        <UAvatar :src="entry.image ?? undefined" :alt="entry.name" size="2xs" />
                        <span class="min-w-0 flex-1 text-left">
                            <span class="block truncate text-sm">{{ entry.name }}</span>
                            <span class="block truncate text-xs text-muted">{{ entry.email }}</span>
                        </span>
                        <UIcon
                            v-if="store.owner?.id === entry.id"
                            name="i-lucide-check"
                            class="size-4 shrink-0 text-primary"
                        />
                    </button>
                </div>
            </template>
        </UPopover>

        <ModifiedFilter :modified="store.modified" @update:modified="onPickModified" />

        <UButton
            v-if="store.hasActiveFilters"
            size="sm"
            color="neutral"
            variant="ghost"
            icon="i-lucide-x"
            label="Clear all"
            aria-label="Clear all"
            :ui="{ label: 'hidden sm:inline' }"
            @click="store.clearFilters()"
        />

        <UDropdownMenu v-if="viewMode === 'grid'" :items="sortItems" class="ml-auto shrink-0">
            <UButton
                icon="i-lucide-arrow-up-down"
                color="neutral"
                variant="ghost"
                :label="sortLabel"
                :aria-label="`Sort by ${ sortLabel }`"
                :ui="{ label: 'hidden sm:inline' }"
            />
        </UDropdownMenu>
    </div>
</template>

<!--------------------------------------------------------------------------------------------------------------------->

<script setup lang="ts">
    import { computed } from 'vue';
    import type { DropdownMenuItem } from '@nuxt/ui';

    import { type NodeSortKey, type NodeTypeFamily, type UserSummary, type ViewMode } from '@fileshed/core';

    // Stores
    import { useDriveStore } from '../../stores/drive.ts';

    // Components
    import TypeFilter from '../filters/typeFilter.vue';
    import ModifiedFilter from '../filters/modifiedFilter.vue';

    // Utils
    import {
        type ModifiedFilter as ModifiedFilterValue,
        ownerChipVisible,
        ownerFilterSummary,
    } from '../../utils/filterPresets.ts';

    //------------------------------------------------------------------------------------------------------------------

    defineProps<{
        viewMode : ViewMode;
    }>();

    const store = useDriveStore();

    const ownerSummary = computed(() => ownerFilterSummary(store.owner));

    //------------------------------------------------------------------------------------------------------------------
    // Sort -- grid view only; list view sorts from its own column headers. The menu drives the store directly.
    //------------------------------------------------------------------------------------------------------------------

    const SORT_LABELS : Record<NodeSortKey, string> = {
        name: 'Name',
        size: 'Size',
        createdAt: 'Created',
        updatedAt: 'Modified',
        kind: 'Kind',
    };

    const sortLabel = computed(() => SORT_LABELS[store.sortKey]);

    const sortItems = computed<DropdownMenuItem[][]>(() => [
        (Object.keys(SORT_LABELS) as NodeSortKey[]).map((key) => ({
            label: SORT_LABELS[key],
            icon: store.sortKey === key ? 'i-lucide-check' : undefined,
            onSelect: () => { void store.reSort(key, store.sortDirection); },
        })),
        [
            {
                label: 'Ascending',
                icon: store.sortDirection === 'asc' ? 'i-lucide-check' : undefined,
                onSelect: () => { void store.reSort(store.sortKey, 'asc'); },
            },
            {
                label: 'Descending',
                icon: store.sortDirection === 'desc' ? 'i-lucide-check' : undefined,
                onSelect: () => { void store.reSort(store.sortKey, 'desc'); },
            },
        ],
    ]);

    //------------------------------------------------------------------------------------------------------------------
    // Filters
    //------------------------------------------------------------------------------------------------------------------

    function onPickTypes(families : NodeTypeFamily[]) : void
    {
        void store.setTypeFamilies(families);
    }

    function onPickModified(next : ModifiedFilterValue | null) : void
    {
        void store.setModified(next);
    }

    function pickOwner(entry : UserSummary | null, close : () => void) : void
    {
        void store.setOwner(entry);
        close();
    }
</script>

<!--------------------------------------------------------------------------------------------------------------------->
