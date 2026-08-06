<!----------------------------------------------------------------------------------------------------------------------
  -- Shared Surface
  --
  -- The body of the Shared with me view: the loading spinner, the load error with its retry, the "nothing shared yet"
  -- empty state, the filtered-to-nothing state, and otherwise the caller's incoming grants as a grid of cards or a dense
  -- row list, per the view toggle. Each item shows the target, the owner's avatar and name, the caller's role, and
  -- whether it is already placed in their files; a double-click opens it and a kebab offers the recipient actions the
  -- page builds. Reads the shared store for its listing state directly; open and the per-row menu relay up.
  --------------------------------------------------------------------------------------------------------------------->

<template>
    <div class="min-h-0 flex-1 select-none">
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

        <div
            v-else-if="viewMode === 'grid'"
            class="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6"
        >
            <SharedTile
                v-for="entry in store.entries"
                :key="entry.share.id"
                :entry="entry"
                :build-menu="buildMenu"
                @open="(e) => emit('open', e)"
            />
        </div>

        <ul v-else class="divide-y divide-default">
            <li
                v-for="entry in store.entries"
                :key="entry.share.id"
                :aria-label="entry.target.name"
                class="flex items-center gap-3 px-3 py-2 text-sm"
                @dblclick="emit('open', entry)"
            >
                <UIcon
                    :name="presentationOf(entry).icon"
                    class="size-5 shrink-0"
                    :class="presentationOf(entry).color"
                />

                <div class="min-w-0 flex-1">
                    <p class="truncate font-medium" :title="entry.target.name">
                        {{ entry.target.name }}
                    </p>
                    <p class="flex items-center gap-1 truncate text-xs text-muted">
                        <UAvatar :src="entry.owner.image ?? undefined" :alt="entry.owner.name" size="2xs" />
                        <span class="truncate">Shared by {{ entry.owner.name }}</span>
                    </p>
                </div>

                <UBadge color="neutral" variant="subtle" size="sm" class="hidden shrink-0 capitalize lg:inline-flex">
                    {{ entry.share.role }}
                </UBadge>
                <span v-if="entry.placed" class="hidden shrink-0 text-xs text-muted lg:inline">In your files</span>

                <span class="hidden w-24 shrink-0 truncate text-right text-muted sm:block">{{ sizeOf(entry) }}</span>

                <UDropdownMenu :items="buildMenu(entry)">
                    <UButton
                        icon="i-lucide-ellipsis-vertical"
                        color="neutral"
                        variant="ghost"
                        size="sm"
                        aria-label="More actions"
                    />
                </UDropdownMenu>
            </li>
        </ul>
    </div>
</template>

<!--------------------------------------------------------------------------------------------------------------------->

<script setup lang="ts">
    import type { DropdownMenuItem } from '@nuxt/ui';

    import type { SharedWithMeEntry, ViewMode } from '@fileshed/core';

    // Stores
    import { useSharedStore } from '../../stores/shared.ts';

    // Components
    import SharedTile from './sharedTile.vue';

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

    const store = useSharedStore();

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
