<!----------------------------------------------------------------------------------------------------------------------
  -- Node Row
  --
  -- One dense row in the list: name with its type icon, size, modified time, kind, and an end-of-row kebab. Same
  -- interaction contract as the grid tile -- click emits selection intent with modifiers, double-click emits open, the
  -- menu items (right-click, or the kebab) are a prop. A dead link dims and reads "Broken link" in the kind column.
  --------------------------------------------------------------------------------------------------------------------->

<template>
    <UContextMenu :items="menuItems">
        <div
            class="group grid cursor-default grid-cols-[1fr_7rem_9rem_6rem_2.5rem] items-center gap-4 border-b
                border-default px-3 py-2 text-sm transition-colors"
            :class="selected ? 'bg-primary/10' : 'hover:bg-elevated/50'"
            role="button"
            tabindex="0"
            :aria-label="node.name"
            @click="onClick"
            @dblclick="emit('open', node)"
            @keydown.enter="emit('open', node)"
        >
            <div class="flex min-w-0 items-center gap-2">
                <div class="relative shrink-0" :class="{ 'opacity-40': dead }">
                    <UIcon :name="presentation.icon" class="size-5" :class="presentation.color" />
                    <UIcon
                        v-if="node.type === 'link' && !dead"
                        name="i-lucide-link"
                        class="absolute -bottom-1 -right-1 size-3 rounded-full bg-default text-muted"
                    />
                </div>
                <span class="truncate font-medium" :class="{ 'text-dimmed': dead }" :title="node.name">
                    {{ node.name }}
                </span>
            </div>

            <span class="truncate text-muted">{{ node.type === 'file' ? formatBytes(node.size) : '—' }}</span>
            <span class="truncate text-muted">{{ formatNodeDate(node.updatedAt) }}</span>
            <span class="truncate text-muted">{{ kindLabel }}</span>

            <div
                class="flex justify-end opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100"
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
        </div>
    </UContextMenu>
</template>

<!--------------------------------------------------------------------------------------------------------------------->

<script setup lang="ts">
    import { computed } from 'vue';
    import type { ContextMenuItem } from '@nuxt/ui';

    import type { NodeResponse } from '@fileshed/core';

    // Utils
    import { formatBytes, formatNodeDate } from '../../utils/formatters/index.ts';
    import { familyPresentation, isDeadLink, nodePresentation } from '../../utils/nodeTypePresentation.ts';

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

    const presentation = computed(() => nodePresentation(props.node));
    const dead = computed(() => isDeadLink(props.node));

    // A resolved link reads "Link" -- what the Links filter matches -- never its target's family, which would make
    // the column and the filter disagree about the same node.
    const kindLabel = computed(() =>
    {
        if(dead.value) { return nodePresentation(props.node).noun; }
        if(props.node.type === 'link') { return familyPresentation('links').noun; }

        return presentation.value.noun;
    });

    function onClick(event : MouseEvent) : void
    {
        emit('select', props.node, event);
    }
</script>

<!--------------------------------------------------------------------------------------------------------------------->
