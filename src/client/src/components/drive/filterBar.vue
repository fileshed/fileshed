<!----------------------------------------------------------------------------------------------------------------------
  -- Filter Bar
  --
  -- The drive's idle bar, shown in the constant-height strip when nothing is selected: the filter chips -- Type
  -- (multi-select families), Owner (single-select from the folder's own owners), and Modified (date presets plus a
  -- custom range), with a Clear all chip when any is active -- and, in grid view, the sort menu (list view sorts from
  -- its own column headers instead). Each chip is a popover; selecting drives the store, which reloads server-side. The
  -- Owner chip hides itself when the folder has a single owner. The strip's height lives on the drive page, so nothing
  -- here changes the row's height.
  --------------------------------------------------------------------------------------------------------------------->

<template>
    <div class="flex h-10 flex-1 items-center gap-2 overflow-x-auto">
        <!-- Type -->
        <USelectMenu
            :model-value="store.typeFamilies"
            multiple
            value-key="value"
            :items="typeItems"
            :search-input="false"
            size="sm"
            icon="i-lucide-shapes"
            :color="store.typeFamilies.length > 0 ? 'primary' : 'neutral'"
            :variant="store.typeFamilies.length > 0 ? 'soft' : 'subtle'"
            :ui="{ content: 'w-56' }"
            @update:model-value="onPickTypes"
        >
            <template #default>
                Type
            </template>
            <template #item-leading="{ item }">
                <UIcon :name="item.icon" class="size-5" :class="item.color" />
            </template>
        </USelectMenu>

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
                <div class="flex w-64 flex-col p-1">
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

        <!-- Modified -->
        <UPopover>
            <UButton
                size="sm"
                color="neutral"
                :variant="store.modified !== null ? 'solid' : 'subtle'"
                icon="i-lucide-calendar"
                trailing-icon="i-lucide-chevron-down"
                :label="modifiedSummary === null ? 'Modified' : `Modified: ${ modifiedSummary }`"
            />

            <template #content="{ close }">
                <div class="flex w-72 flex-col p-1">
                    <button
                        type="button"
                        class="flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 hover:bg-elevated"
                        @click="pickPreset(null, close)"
                    >
                        <span class="flex-1 text-left text-sm">Any time</span>
                        <UIcon v-if="store.modified === null" name="i-lucide-check" class="size-4 text-primary" />
                    </button>

                    <button
                        v-for="preset in modifiedPresets"
                        :key="preset"
                        type="button"
                        class="flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 hover:bg-elevated"
                        @click="pickPreset(preset, close)"
                    >
                        <span class="flex-1 text-left text-sm">{{ MODIFIED_PRESET_LABELS[preset] }}</span>
                        <UIcon v-if="isActivePreset(preset)" name="i-lucide-check" class="size-4 text-primary" />
                    </button>

                    <USeparator class="my-1" />

                    <div class="p-1">
                        <p class="px-1 pb-1 text-xs font-medium text-muted">
                            Custom range
                        </p>
                        <UCalendar v-model="range" range class="w-full" />
                        <div class="mt-2 flex justify-end gap-2">
                            <UButton size="sm" color="neutral" variant="ghost" label="Cancel" @click="close" />
                            <UButton
                                size="sm"
                                label="Apply"
                                :disabled="!rangeComplete"
                                @click="applyCustom(close)"
                            />
                        </div>
                    </div>
                </div>
            </template>
        </UPopover>

        <UButton
            v-if="store.hasActiveFilters"
            size="sm"
            color="neutral"
            variant="ghost"
            icon="i-lucide-x"
            label="Clear all"
            @click="store.clearFilters()"
        />

        <UDropdownMenu v-if="viewMode === 'grid'" :items="sortItems" class="ml-auto">
            <UButton icon="i-lucide-arrow-up-down" color="neutral" variant="ghost" :label="sortLabel" />
        </UDropdownMenu>
    </div>
</template>

<!--------------------------------------------------------------------------------------------------------------------->

<script setup lang="ts">
    import { computed, shallowRef } from 'vue';
    import { type DateValue, getLocalTimeZone } from '@internationalized/date';
    import type { DropdownMenuItem } from '@nuxt/ui';

    import {
        type NodeSortKey,
        type NodeTypeFamily,
        type UserSummary,
        type ViewMode,
        nodeTypeFamilies,
    } from '@fileshed/core';

    // Stores
    import { useDriveStore } from '../../stores/drive.ts';

    // Utils
    import {
        MODIFIED_PRESET_LABELS,
        type ModifiedPreset,
        modifiedFilterSummary,
        modifiedPresets,
        ownerChipVisible,
        ownerFilterSummary,
    } from '../../utils/filterPresets.ts';
    import { familyPresentation } from '../../utils/nodeTypePresentation.ts';

    //------------------------------------------------------------------------------------------------------------------

    defineProps<{
        viewMode : ViewMode;
    }>();

    const store = useDriveStore();

    const ownerSummary = computed(() => ownerFilterSummary(store.owner));
    const modifiedSummary = computed(() => modifiedFilterSummary(store.modified));

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
    // Type
    //------------------------------------------------------------------------------------------------------------------

    // The whole family vocabulary as dropdown items, each carrying its coloured icon from the shared presentation
    // table. value-key stores just the family on selection, so the menu's model is the store's typeFamilies verbatim.
    const typeItems = nodeTypeFamilies.map((family) =>
    {
        const presentation = familyPresentation(family);
        return { value: family, label: presentation.label, icon: presentation.icon, color: presentation.color };
    });

    function onPickTypes(families : NodeTypeFamily[]) : void
    {
        void store.setTypeFamilies(families);
    }

    //------------------------------------------------------------------------------------------------------------------
    // Owner
    //------------------------------------------------------------------------------------------------------------------

    function pickOwner(entry : UserSummary | null, close : () => void) : void
    {
        void store.setOwner(entry);
        close();
    }

    //------------------------------------------------------------------------------------------------------------------
    // Modified
    //------------------------------------------------------------------------------------------------------------------

    interface CalRange { start : DateValue | undefined; end : DateValue | undefined }
    const range = shallowRef<CalRange | null>(null);

    const rangeComplete = computed(() => range.value?.start !== undefined && range.value?.end !== undefined);

    function isActivePreset(preset : ModifiedPreset) : boolean
    {
        return store.modified?.kind === 'preset' && store.modified.preset === preset;
    }

    function pickPreset(preset : ModifiedPreset | null, close : () => void) : void
    {
        void store.setModified(preset === null ? null : { kind: 'preset', preset });
        close();
    }

    // The calendar's inclusive day range becomes the server's half-open window: the start day's local midnight, up to
    // (but not including) the local midnight after the end day.
    function applyCustom(close : () => void) : void
    {
        const value = range.value;
        if(value?.start === undefined || value.end === undefined) { return; }

        const tz = getLocalTimeZone();
        const after = value.start.toDate(tz).toISOString();
        const before = value.end.add({ days: 1 }).toDate(tz)
            .toISOString();

        void store.setModified({ kind: 'range', after, before });
        close();
    }
</script>

<!--------------------------------------------------------------------------------------------------------------------->
