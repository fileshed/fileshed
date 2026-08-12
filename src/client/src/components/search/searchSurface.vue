<!----------------------------------------------------------------------------------------------------------------------
  -- Search Surface
  --
  -- The body of the Search view: the loading spinner, the load error with its retry, "No files match" when the query
  -- resolved to nothing, and otherwise the result count line plus a dense row per hit -- name with its sharing, plus
  -- owner, size, modified, and type, the same facts the drive's list view shows. The name outranks the metadata
  -- columns, which leave as the surface narrows until only the name and the go-to-folder jump remain. Opening relays up
  -- so the page runs the shared open intent; there is no selection and no per-row menu here, since search is a finder,
  -- not a manager. Reads the search store for its listing state directly.
  --
  -- One request answers a search in full, so the rows are all here at once and only the ones in view are mounted. The
  -- column header sits outside the scroller, so it pads itself by the scrollbar the scroller always reserves.
  --------------------------------------------------------------------------------------------------------------------->

<template>
    <div class="flex min-h-0 flex-1 flex-col select-none">
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
            <p class="mb-2 shrink-0 text-sm text-muted">
                {{ store.total }} result{{ store.total === 1 ? '' : 's' }} for "{{ store.q }}"
            </p>

            <div
                class="grid shrink-0 grid-cols-[minmax(0,1fr)_2.5rem] sm:grid-cols-[minmax(0,1fr)_9rem_2.5rem]
                    lg:grid-cols-[minmax(0,1fr)_7rem_9rem_2.5rem]
                    xl:grid-cols-[minmax(0,1fr)_10rem_6rem_9rem_6rem_2.5rem] gap-2 border-b border-default px-3 pb-2
                    text-xs font-semibold text-muted sm:gap-4"
                :style="{ paddingRight: `calc(0.75rem + ${ gutter }px)` }"
            >
                <span>Name</span>
                <span class="hidden lg:block">Owner</span>
                <span class="hidden xl:block">Size</span>
                <span class="hidden sm:block">Modified</span>
                <span class="hidden xl:block">Type</span>
                <span class="sr-only">Actions</span>
            </div>

            <VirtualScroller
                class="min-h-0 flex-1 [scrollbar-gutter:stable]"
                :items="rows"
                :item-height="rowHeight"
                :item-key="(row : ResultRow) => row.node.id"
            >
                <template #default="{ item: row } : { item : ResultRow }">
                    <div
                        class="grid h-14 cursor-default grid-cols-[minmax(0,1fr)_2.5rem]
                            sm:grid-cols-[minmax(0,1fr)_9rem_2.5rem]
                            lg:grid-cols-[minmax(0,1fr)_7rem_9rem_2.5rem]
                            xl:grid-cols-[minmax(0,1fr)_10rem_6rem_9rem_6rem_2.5rem] items-center gap-2 border-b
                            border-default px-3 text-sm transition-colors hover:bg-elevated/50 sm:h-12 sm:gap-4"
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
                            <SharingBadges :sharing="row.node.sharing" />
                        </div>

                        <div class="hidden min-w-0 items-center gap-2 lg:flex">
                            <UAvatar
                                :src="ownerImage(row.node) ?? undefined"
                                :alt="ownerLabel(row.node)"
                                size="2xs"
                            />
                            <span class="truncate text-muted">{{ ownerLabel(row.node) }}</span>
                        </div>

                        <span class="hidden truncate text-muted xl:block">
                            {{ row.node.type === 'file' ? formatBytes(row.node.size) : '—' }}
                        </span>
                        <span class="hidden truncate text-muted sm:block">
                            {{ formatNodeDate(row.node.updatedAt, session.timeFormat) }}
                        </span>
                        <span class="hidden truncate text-muted xl:block">{{ nodeKindLabel(row.node) }}</span>

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
                </template>
            </VirtualScroller>
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
    import SharingBadges from '../share/sharingBadges.vue';
    import LocationLine from './locationLine.vue';
    import VirtualScroller from '../listing/virtualScroller.vue';

    // Engines
    import { containingFolderRoute } from '../../engines/location.ts';

    // Resource Access
    import { useListingMetrics } from '../../resource-access/listingMetrics.ts';
    import { scrollbarWidth } from '../../resource-access/scrollbarWidth.ts';

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

    const { rowHeight } = useListingMetrics();
    const gutter = scrollbarWidth();

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
