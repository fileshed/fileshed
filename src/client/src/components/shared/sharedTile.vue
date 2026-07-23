<!----------------------------------------------------------------------------------------------------------------------
  -- Shared Tile
  --
  -- One card in the Shared with me grid: the target's type icon, its name, the owner's attribution, the caller's role,
  -- a placement note, and size for a file -- the same facts the shared row carries, laid out as a card that matches the
  -- drive's grid tiles. Presentational only: a double-click emits open, the kebab items arrive as a prop.
  --------------------------------------------------------------------------------------------------------------------->

<template>
    <div
        class="group relative flex cursor-default flex-col items-center gap-2 rounded-lg border border-default p-4
            text-center transition-colors hover:bg-elevated/50"
        role="button"
        tabindex="0"
        :aria-label="entry.target.name"
        @dblclick="emit('open', entry)"
        @keydown.enter="emit('open', entry)"
    >
        <div
            class="absolute right-1 top-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100"
            @dblclick.stop
        >
            <UDropdownMenu :items="buildMenu(entry)" :ui="{ content: 'w-48' }">
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
            <p class="truncate text-sm font-medium" :title="entry.target.name">
                {{ entry.target.name }}
            </p>
            <p class="mt-0.5 flex items-center justify-center gap-1 truncate text-xs text-muted">
                <UAvatar :src="entry.owner.image ?? undefined" :alt="entry.owner.name" size="2xs" />
                <span class="truncate">Shared by {{ entry.owner.name }}</span>
            </p>
        </div>

        <div class="flex flex-wrap items-center justify-center gap-1.5">
            <UBadge color="neutral" variant="subtle" size="sm" class="capitalize">
                {{ entry.share.role }}
            </UBadge>
            <span v-if="entry.placed" class="text-xs text-muted">In your files</span>
            <span class="text-xs text-muted">{{ size }}</span>
        </div>
    </div>
</template>

<!--------------------------------------------------------------------------------------------------------------------->

<script setup lang="ts">
    import { computed } from 'vue';
    import type { DropdownMenuItem } from '@nuxt/ui';

    import type { SharedWithMeEntry } from '@fileshed/core';

    // Utils
    import { type NodeTypePresentation, sharedTargetPresentation } from '../../utils/nodeTypePresentation.ts';
    import { formatBytes } from '../../utils/formatters/index.ts';

    //------------------------------------------------------------------------------------------------------------------

    const props = defineProps<{
        entry : SharedWithMeEntry;
        buildMenu : (entry : SharedWithMeEntry) => DropdownMenuItem[][];
    }>();

    const emit = defineEmits<{
        open : [ entry : SharedWithMeEntry ];
    }>();

    const presentation = computed<NodeTypePresentation>(() => sharedTargetPresentation(props.entry.target));
    const size = computed(() =>
    {
        const { target } = props.entry;
        return target.type === 'file' && target.size !== undefined ? formatBytes(target.size) : '—';
    });
</script>

<!--------------------------------------------------------------------------------------------------------------------->
