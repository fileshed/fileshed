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
                class="grid grid-cols-[1fr_10rem_6rem_9rem_6rem_2.5rem] gap-4 border-b border-default px-3 pb-2
                    text-xs font-semibold text-muted"
            >
                <span>Name</span>
                <span>Owner</span>
                <span>Size</span>
                <span>Modified</span>
                <span>Type</span>
                <span class="sr-only">Actions</span>
            </div>

            <div
                v-for="row in rows"
                :key="row.node.id"
                class="grid cursor-default grid-cols-[1fr_10rem_6rem_9rem_6rem_2.5rem] items-center gap-4 border-b
                    border-default px-3 py-2 text-sm transition-colors hover:bg-elevated/50"
                role="button"
                tabindex="0"
                :aria-label="row.node.name"
                @dblclick="emit('open', row.node)"
                @keydown.enter="emit('open', row.node)"
            >
                <div class="flex min-w-0 items-center gap-2">
                    <UIcon
                        :name="presentationOf(row.node).icon"
                        class="size-5 shrink-0"
                        :class="[ presentationOf(row.node).color, { 'opacity-40': isDeadLink(row.node) } ]"
                    />
                    <div class="flex min-w-0 flex-col">
                        <span
                            class="truncate font-medium"
                            :class="{ 'text-dimmed': isDeadLink(row.node) }"
                            :title="row.node.name"
                        >
                            {{ row.node.name }}
                        </span>
                        <LocationLine
                            v-if="row.location"
                            :location="row.location"
                            :root-label="session.rootLabel"
                        />
                    </div>
                </div>

                <div class="flex min-w-0 items-center gap-2">
                    <UAvatar :src="ownerImage(row.node) ?? undefined" :alt="ownerLabel(row.node)" size="2xs" />
                    <span class="truncate text-muted">{{ ownerLabel(row.node) }}</span>
                </div>

                <span class="truncate text-muted">
                    {{ row.node.type === 'file' ? formatBytes(row.node.size) : '—' }}
                </span>
                <span class="truncate text-muted">{{ formatNodeDate(row.node.updatedAt, session.timeFormat) }}</span>
                <span class="truncate text-muted">{{ nodeKindLabel(row.node) }}</span>

                <UButton
                    v-if="row.folderRoute"
                    :to="row.folderRoute"
                    icon="i-lucide-folder-open"
                    color="neutral"
                    variant="ghost"
                    size="xs"
                    :aria-label="`Open the folder containing ${ row.node.name }`"
                    :title="`Open the folder containing ${ row.node.name }`"
                />
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
    import { computed } from 'vue';

    import type { NodeLocation, NodeResponse } from '@fileshed/core';

    // Stores
    import { useSearchStore } from '../../stores/search.ts';
    import { useSessionStore } from '../../stores/session.ts';

    // Components
    import LocationLine from './locationLine.vue';

    // Engines
    import { containingFolderRoute } from '../../engines/location.ts';

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

    interface ResultRow
    {
        node : NodeResponse;
        location : NodeLocation | null;

        // Where the go-to-folder button lands, or null when the containing folder is out of the caller's reach and
        // there is nowhere to send them.
        folderRoute : string | null;
    }

    const rows = computed<ResultRow[]>(() => store.nodes.map((node) =>
    {
        const location = store.locations[node.id] ?? null;

        return {
            node,
            location,
            folderRoute: location === null ? null : containingFolderRoute(location, node.parentID, node.id),
        };
    }));

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
