<!----------------------------------------------------------------------------------------------------------------------
  -- Search Surface
  --
  -- The body of the Search view: the loading spinner, the load error with its retry, "No files match" when the query
  -- resolved to nothing, and otherwise the result count line plus a dense row per hit -- name, owner, size, modified,
  -- type, the same facts the drive's list view shows. Opening relays up so the page runs the shared open intent; there
  -- is no selection and no per-row menu here, since search is a finder, not a manager. Reads the search store for its
  -- listing state directly.
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
            <p>We couldn't run that search.</p>
            <UButton color="neutral" variant="subtle" label="Retry" @click="store.retry()" />
        </div>

        <div
            v-else-if="store.isEmpty"
            class="flex h-64 flex-col items-center justify-center gap-3 text-center text-dimmed"
        >
            <UIcon name="i-lucide-search-x" class="size-10" />
            <p>No files match "{{ store.q }}".</p>
        </div>

        <template v-else>
            <p class="mb-2 text-sm text-muted">
                {{ store.total }} result{{ store.total === 1 ? '' : 's' }} for "{{ store.q }}"
            </p>

            <div
                class="grid grid-cols-[1fr_10rem_6rem_9rem_6rem] gap-4 border-b border-default px-3 pb-2 text-xs
                    font-semibold text-muted"
            >
                <span>Name</span>
                <span>Owner</span>
                <span>Size</span>
                <span>Modified</span>
                <span>Type</span>
            </div>

            <div
                v-for="node in store.nodes"
                :key="node.id"
                class="grid cursor-default grid-cols-[1fr_10rem_6rem_9rem_6rem] items-center gap-4 border-b
                    border-default px-3 py-2 text-sm transition-colors hover:bg-elevated/50"
                role="button"
                tabindex="0"
                :aria-label="node.name"
                @dblclick="emit('open', node)"
                @keydown.enter="emit('open', node)"
            >
                <div class="flex min-w-0 items-center gap-2">
                    <UIcon
                        :name="presentationOf(node).icon"
                        class="size-5 shrink-0"
                        :class="[ presentationOf(node).color, { 'opacity-40': isDeadLink(node) } ]"
                    />
                    <span class="truncate font-medium" :class="{ 'text-dimmed': isDeadLink(node) }" :title="node.name">
                        {{ node.name }}
                    </span>
                </div>

                <div class="flex min-w-0 items-center gap-2">
                    <UAvatar :src="ownerImage(node) ?? undefined" :alt="ownerLabel(node)" size="2xs" />
                    <span class="truncate text-muted">{{ ownerLabel(node) }}</span>
                </div>

                <span class="truncate text-muted">{{ node.type === 'file' ? formatBytes(node.size) : '—' }}</span>
                <span class="truncate text-muted">{{ formatNodeDate(node.updatedAt, session.timeFormat) }}</span>
                <span class="truncate text-muted">{{ nodeKindLabel(node) }}</span>
            </div>

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
    import type { NodeResponse } from '@fileshed/core';

    // Stores
    import { useSearchStore } from '../../stores/search.ts';
    import { useSessionStore } from '../../stores/session.ts';

    // Utils
    import {
        type NodeTypePresentation,
        formatBytes,
        formatNodeDate,
        isDeadLink,
        nodeKindLabel,
        nodePresentation,
    } from '../../utils/formatters/index.ts';
    import { ownerIDFor, resolveOwner } from '../../utils/resolveOwner.ts';

    //------------------------------------------------------------------------------------------------------------------

    const emit = defineEmits<{
        open : [ node : NodeResponse ];
    }>();

    const store = useSearchStore();
    const session = useSessionStore();

    function presentationOf(node : NodeResponse) : NodeTypePresentation
    {
        return nodePresentation(node);
    }

    // The owners facet carries a UserSummary per distinct owner among the results, the same shape the drive's owner
    // filter draws from -- a hit whose owner rides in it gets a real name and avatar. A link attributes to its
    // resolved TARGET's owner, not its own (falling back to its own when dead), same as the drive row. One not in
    // the facet falls back to "You" for the caller's own files, the raw id otherwise.
    function ownerLabel(node : NodeResponse) : string
    {
        const id = ownerIDFor(node);
        const summary = resolveOwner(id, store.owners);
        if(summary !== null) { return summary.name; }

        return id === session.me?.id ? 'You' : id;
    }

    function ownerImage(node : NodeResponse) : string | null
    {
        return resolveOwner(ownerIDFor(node), store.owners)?.image ?? null;
    }
</script>

<!--------------------------------------------------------------------------------------------------------------------->
