<!----------------------------------------------------------------------------------------------------------------------
  -- Node Row
  --
  -- One dense row in the list: name with its type icon, owner, size, modified time, kind, and an end-of-row kebab.
  -- The name outranks the metadata columns: at narrow widths Type leaves first, then Size, so the name always keeps
  -- readable room.
  -- Same interaction contract as the grid tile -- click emits selection intent with modifiers, double-click emits
  -- open, the menu items (right-click, or the kebab) are a prop. A dead link dims and reads "Broken link" in the kind
  -- column. The owner avatar resolves against the listing's owners facet -- a link attributes to its resolved
  -- TARGET's owner, falling back to the link's own owner when dead; a miss (should not happen for a drive listing)
  -- falls back to an initials avatar keyed off the raw owner id instead of hiding the cell.
  --------------------------------------------------------------------------------------------------------------------->

<template>
    <UContextMenu :items="menuItems">
        <div
            class="group grid cursor-default grid-cols-[minmax(0,1fr)_2.5rem_9rem_2.5rem]
                md:grid-cols-[minmax(0,1fr)_2.5rem_7rem_9rem_2.5rem]
                lg:grid-cols-[minmax(0,1fr)_2.5rem_7rem_9rem_6rem_2.5rem] items-center gap-4
                border-b border-default px-3 py-2 text-sm transition-colors"
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

            <div class="flex justify-center" @click.stop @dblclick.stop>
                <UserSummaryHover v-if="owner !== null" :summary="owner">
                    <UAvatar :src="owner.image ?? undefined" :alt="owner.name" size="xs" />
                </UserSummaryHover>
                <UAvatar v-else :alt="ownerID" size="xs" />
            </div>

            <span class="hidden truncate text-muted md:block">
                {{ node.type === 'file' ? formatBytes(node.size) : '—' }}
            </span>
            <span class="truncate text-muted">{{ formatNodeDate(node.updatedAt, session.timeFormat) }}</span>
            <span class="hidden truncate text-muted lg:block">{{ kindLabel }}</span>

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

    import type { NodeResponse, UserSummary } from '@fileshed/core';

    // Stores
    import { useSessionStore } from '../../stores/session.ts';

    // Components
    import UserSummaryHover from '../userSummaryHover.vue';

    // Utils
    import { formatBytes, formatNodeDate } from '../../utils/formatters/index.ts';
    import { isDeadLink, nodeKindLabel, nodePresentation } from '../../utils/nodeTypePresentation.ts';
    import { ownerIDFor, resolveOwner } from '../../utils/resolveOwner.ts';

    //------------------------------------------------------------------------------------------------------------------

    const props = defineProps<{
        node : NodeResponse;
        selected : boolean;
        menuItems : ContextMenuItem[][];
        owners : UserSummary[];
    }>();

    const emit = defineEmits<{
        select : [ node : NodeResponse, event : MouseEvent ];
        open : [ node : NodeResponse ];
    }>();

    //------------------------------------------------------------------------------------------------------------------

    const session = useSessionStore();

    const presentation = computed(() => nodePresentation(props.node));
    const dead = computed(() => isDeadLink(props.node));
    const kindLabel = computed(() => nodeKindLabel(props.node));
    const ownerID = computed(() => ownerIDFor(props.node));
    const owner = computed(() => resolveOwner(ownerID.value, props.owners));

    function onClick(event : MouseEvent) : void
    {
        emit('select', props.node, event);
    }
</script>

<!--------------------------------------------------------------------------------------------------------------------->
