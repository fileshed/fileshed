<!----------------------------------------------------------------------------------------------------------------------
  -- Trash Surface
  --
  -- The body of the Trash view: the loading spinner, the load error with its retry, the "Trash is empty" state, the
  -- filtered-to-nothing state, and otherwise the caller's trashed roots as a grid of cards or a dense row list, per the
  -- view toggle. Each item carries Restore and Delete forever; the actions relay up so the page owns restore (a direct
  -- mutation) and Delete forever (a confirm modal). Reads the trash store for its listing state directly.
  --------------------------------------------------------------------------------------------------------------------->

<template>
    <div class="min-h-0 flex-1">
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
            <div
                v-if="viewMode === 'grid'"
                class="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6"
            >
                <TrashTile
                    v-for="node in store.items"
                    :key="node.id"
                    :node="node"
                    @restore="(n) => emit('restore', n)"
                    @delete="(n) => emit('delete', n)"
                />
            </div>

            <ul v-else class="divide-y divide-default">
                <li
                    v-for="node in store.items"
                    :key="node.id"
                    :aria-label="node.name"
                    class="flex items-center gap-3 px-3 py-2 text-sm"
                >
                    <UIcon :name="presentationOf(node).icon" class="size-5 shrink-0" :class="presentationOf(node).color" />
                    <span class="min-w-0 flex-1 truncate font-medium" :title="node.name">{{ node.name }}</span>
                    <span class="w-24 shrink-0 truncate text-right text-muted">{{ sizeOf(node) }}</span>

                    <div class="flex shrink-0 items-center gap-1">
                        <UButton
                            icon="i-lucide-rotate-ccw"
                            color="neutral"
                            variant="ghost"
                            size="sm"
                            label="Restore"
                            aria-label="Restore"
                            @click="emit('restore', node)"
                        />
                        <UButton
                            icon="i-lucide-trash-2"
                            color="error"
                            variant="ghost"
                            size="sm"
                            label="Delete forever"
                            aria-label="Delete forever"
                            @click="emit('delete', node)"
                        />
                    </div>
                </li>
            </ul>

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
    import type { NodeResponse, ViewMode } from '@fileshed/core';

    // Stores
    import { useTrashStore } from '../../stores/trash.ts';

    // Components
    import TrashTile from './trashTile.vue';

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

    function presentationOf(node : NodeResponse) : NodeTypePresentation
    {
        return nodePresentation(node);
    }

    function sizeOf(node : NodeResponse) : string
    {
        return node.type === 'file' ? formatBytes(node.size) : '—';
    }
</script>

<!--------------------------------------------------------------------------------------------------------------------->
