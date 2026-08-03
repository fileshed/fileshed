<!----------------------------------------------------------------------------------------------------------------------
  -- Trash Tile
  --
  -- One card in the Trash grid: the trashed root's type icon, its name, its size for a file, and a corner kebab
  -- carrying Restore and Delete forever -- the same actions the trash row offers, laid out as a card that matches the
  -- drive's grid tiles. Presentational only: the menu items arrive as a prop, so the page still owns restore and the
  -- delete confirm.
  --------------------------------------------------------------------------------------------------------------------->

<template>
    <div
        class="group relative flex flex-col items-center gap-2 rounded-lg border border-default p-4 text-center"
        :aria-label="node.name"
    >
        <div
            class="absolute right-1 top-1 opacity-0 transition-opacity group-hover:opacity-100
                focus-within:opacity-100 pointer-coarse:opacity-100"
        >
            <UDropdownMenu :items="menuItems" :ui="{ content: 'w-48' }">
                <UButton
                    icon="i-lucide-ellipsis-vertical"
                    color="neutral"
                    variant="ghost"
                    size="xs"
                    aria-label="More actions"
                />
            </UDropdownMenu>
        </div>

        <UIcon :name="presentation.icon" class="size-12" :class="presentation.color" />

        <div class="min-w-0 w-full">
            <p class="truncate text-sm font-medium" :title="node.name">
                {{ node.name }}
            </p>
            <p class="mt-0.5 truncate text-xs text-muted">
                {{ size }}
            </p>
        </div>
    </div>
</template>

<!--------------------------------------------------------------------------------------------------------------------->

<script setup lang="ts">
    import { computed } from 'vue';
    import type { DropdownMenuItem } from '@nuxt/ui';

    import type { NodeResponse } from '@fileshed/core';

    // Utils
    import { type NodeTypePresentation, formatBytes, nodePresentation } from '../../utils/formatters/index.ts';

    //------------------------------------------------------------------------------------------------------------------

    const props = defineProps<{
        node : NodeResponse;
        menuItems : DropdownMenuItem[][];
    }>();

    const presentation = computed<NodeTypePresentation>(() => nodePresentation(props.node));
    const size = computed(() =>
    {
        return props.node.type === 'file' ? formatBytes(props.node.size) : '—';
    });
</script>

<!--------------------------------------------------------------------------------------------------------------------->
