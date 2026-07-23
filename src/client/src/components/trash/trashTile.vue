<!----------------------------------------------------------------------------------------------------------------------
  -- Trash Tile
  --
  -- One card in the Trash grid: the trashed root's type icon, its name, its size for a file, and the Restore / Delete
  -- forever actions -- the same actions the trash row carries, laid out as a card that matches the drive's grid tiles.
  -- Presentational only: the actions relay up so the page owns restore and the delete confirm.
  --------------------------------------------------------------------------------------------------------------------->

<template>
    <div
        class="group flex flex-col items-center gap-2 rounded-lg border border-default p-4 text-center"
        :aria-label="node.name"
    >
        <UIcon :name="presentation.icon" class="size-12" :class="presentation.color" />

        <div class="min-w-0 w-full">
            <p class="truncate text-sm font-medium" :title="node.name">
                {{ node.name }}
            </p>
            <p class="mt-0.5 truncate text-xs text-muted">
                {{ size }}
            </p>
        </div>

        <div class="flex items-center gap-1">
            <UButton
                icon="i-lucide-rotate-ccw"
                color="neutral"
                variant="ghost"
                size="xs"
                label="Restore"
                aria-label="Restore"
                @click="emit('restore', node)"
            />
            <UButton
                icon="i-lucide-trash-2"
                color="error"
                variant="ghost"
                size="xs"
                label="Delete forever"
                aria-label="Delete forever"
                @click="emit('delete', node)"
            />
        </div>
    </div>
</template>

<!--------------------------------------------------------------------------------------------------------------------->

<script setup lang="ts">
    import { computed } from 'vue';

    import type { NodeResponse } from '@fileshed/core';

    // Utils
    import { type NodeTypePresentation, nodePresentation } from '../../utils/nodeTypePresentation.ts';
    import { formatBytes } from '../../utils/formatters/index.ts';

    //------------------------------------------------------------------------------------------------------------------

    const props = defineProps<{
        node : NodeResponse;
    }>();

    const emit = defineEmits<{
        restore : [ node : NodeResponse ];
        delete : [ node : NodeResponse ];
    }>();

    const presentation = computed<NodeTypePresentation>(() => nodePresentation(props.node));
    const size = computed(() =>
    {
        return props.node.type === 'file' ? formatBytes(props.node.size) : '—';
    });
</script>

<!--------------------------------------------------------------------------------------------------------------------->
