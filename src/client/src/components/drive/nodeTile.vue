<!----------------------------------------------------------------------------------------------------------------------
  -- Node Tile
  --
  -- One card in the grid: a type icon (a link overlays a small badge; a dead link dims to a broken glyph), the name
  -- truncated with the full name on hover, and size plus modified time for files. Presentational only -- a click emits
  -- selection intent with its modifiers, a double-click emits open, and the menu items (right-click, or the corner
  -- kebab) arrive as a prop.
  --------------------------------------------------------------------------------------------------------------------->

<template>
    <UContextMenu :items="menuItems">
        <div
            class="group relative flex cursor-default flex-col items-center gap-2 rounded-lg border p-4 text-center
                transition-colors"
            :class="selected
                ? 'border-primary bg-primary/10 ring-1 ring-primary'
                : 'border-default hover:bg-elevated/50'"
            role="button"
            tabindex="0"
            :aria-label="node.name"
            @click="onClick"
            @dblclick="emit('open', node)"
            @keydown.enter="emit('open', node)"
        >
            <div
                class="absolute right-1 top-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100"
                @click.stop
                @dblclick.stop
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

            <div class="relative" :class="{ 'opacity-40': dead }">
                <UIcon :name="presentation.icon" class="size-12" :class="presentation.color" />
                <UIcon
                    v-if="node.type === 'link' && !dead"
                    name="i-lucide-link"
                    class="absolute -bottom-0.5 -right-0.5 size-4 rounded-full bg-default p-0.5 text-muted"
                />
            </div>

            <div class="min-w-0 w-full">
                <p class="truncate text-sm font-medium" :class="{ 'text-dimmed': dead }" :title="node.name">
                    {{ node.name }}
                </p>
                <p v-if="node.type === 'file'" class="mt-0.5 truncate text-xs text-muted">
                    {{ formatBytes(node.size) }} · {{ formatNodeDate(node.updatedAt, session.timeFormat) }}
                </p>
                <p v-else-if="dead" class="mt-0.5 text-xs text-dimmed">
                    Broken link
                </p>
            </div>
        </div>
    </UContextMenu>
</template>

<!--------------------------------------------------------------------------------------------------------------------->

<script setup lang="ts">
    import { computed } from 'vue';
    import type { ContextMenuItem } from '@nuxt/ui';

    import type { NodeResponse } from '@fileshed/core';

    // Stores
    import { useSessionStore } from '../../stores/session.ts';

    // Utils
    import { formatBytes, formatNodeDate } from '../../utils/formatters/index.ts';
    import { isDeadLink, nodePresentation } from '../../utils/nodeTypePresentation.ts';

    //------------------------------------------------------------------------------------------------------------------

    const props = defineProps<{
        node : NodeResponse;
        selected : boolean;
        menuItems : ContextMenuItem[][];
    }>();

    const emit = defineEmits<{
        select : [ node : NodeResponse, event : MouseEvent ];
        open : [ node : NodeResponse ];
    }>();

    //------------------------------------------------------------------------------------------------------------------

    const session = useSessionStore();

    const presentation = computed(() => nodePresentation(props.node));
    const dead = computed(() => isDeadLink(props.node));

    function onClick(event : MouseEvent) : void
    {
        emit('select', props.node, event);
    }
</script>

<!--------------------------------------------------------------------------------------------------------------------->
