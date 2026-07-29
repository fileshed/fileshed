//----------------------------------------------------------------------------------------------------------------------
// Trash Store
//
// State and orchestration behind the Trash view: the caller's trashed subtree roots, loaded a page at a time, plus the
// mutations that act on them -- restore (back to its place, or the owner's root when that place is gone), permanent
// delete of one root, and emptying every root at once. Restore and single-root delete refetch the listing; emptying
// resets it directly, since nothing is left to page. Mutation errors propagate to the caller to toast; a failed
// listing lands in `error` for the surface's retry state.
//----------------------------------------------------------------------------------------------------------------------

import { computed, ref } from 'vue';
import { defineStore } from 'pinia';

import {
    DEFAULT_CHILDREN_LIMIT,
    MAX_CHILDREN_LIMIT,
    type NodeResponse,
    type NodeTypeFamily,
} from '@fileshed/core';

// Resource Access
import { emptyTrash, getTrash, hardDeleteNode, restoreNode } from '../resource-access/nodes.ts';

// Stores
import { useSessionStore } from './session.ts';

// Utils
import { type ModifiedFilter, modifiedRange } from '../utils/filterPresets.ts';

//----------------------------------------------------------------------------------------------------------------------

export const useTrashStore = defineStore('trash', () =>
{
    const items = ref<NodeResponse[]>([]);
    const total = ref(0);
    const loading = ref(false);
    const loadingMore = ref(false);
    const error = ref<Error | null>(null);

    // The active Type/Modified filters. Per-page-visit, not persisted: a fresh visit (load) drops them, while a
    // mutation's refresh holds them so restoring an item never clears the filter the user set.
    const typeFamilies = ref<NodeTypeFamily[]>([]);
    const modified = ref<ModifiedFilter | null>(null);

    const isEmpty = computed(() => !loading.value && error.value === null && items.value.length === 0);
    const hasMore = computed(() => items.value.length < total.value);
    const hasActiveFilters = computed(() => typeFamilies.value.length > 0 || modified.value !== null);

    // An empty result WITH an active filter is a distinct surface state from a genuinely empty trash.
    const filteredEmpty = computed(() => isEmpty.value && hasActiveFilters.value);

    // The current filters as a trash-query fragment: an empty type selection and an absent date window are dropped so
    // the server reads them as unfiltered.
    function filterParams() : { types ?: NodeTypeFamily[]; updatedAfter ?: string; updatedBefore ?: string }
    {
        const params : { types ?: NodeTypeFamily[]; updatedAfter ?: string; updatedBefore ?: string } = {};

        if(typeFamilies.value.length > 0) { params.types = [ ...typeFamilies.value ]; }
        if(modified.value !== null)
        {
            const window = modifiedRange(modified.value);
            if(window.after !== undefined) { params.updatedAfter = window.after; }
            if(window.before !== undefined) { params.updatedBefore = window.before; }
        }

        return params;
    }

    function resetFilters() : void
    {
        typeFamilies.value = [];
        modified.value = null;
    }

    async function fetchFirstPage() : Promise<void>
    {
        loading.value = true;
        error.value = null;

        try
        {
            const page = await getTrash({ limit: DEFAULT_CHILDREN_LIMIT, offset: 0, ...filterParams() });
            items.value = page.nodes;
            total.value = page.total;
        }
        catch(caught)
        {
            error.value = caught instanceof Error ? caught : new Error('Failed to load the trash.');
            items.value = [];
            total.value = 0;
        }
        finally
        {
            loading.value = false;
        }
    }

    // A fresh visit to the trash: filters reset, then the first page loads unfiltered.
    async function load() : Promise<void>
    {
        resetFilters();
        await fetchFirstPage();
    }

    async function loadMore() : Promise<void>
    {
        if(loadingMore.value || !hasMore.value) { return; }

        loadingMore.value = true;
        try
        {
            const page = await getTrash({
                limit: DEFAULT_CHILDREN_LIMIT,
                offset: items.value.length,
                ...filterParams(),
            });
            items.value = [ ...items.value, ...page.nodes ];
            total.value = page.total;
        }
        finally
        {
            loadingMore.value = false;
        }
    }

    // Re-read the trash, holding the window the user has paged open and the filters in force, so a mutation reflects
    // without collapsing back to the first page or dropping the active filter.
    async function refresh() : Promise<void>
    {
        const window = Math.min(Math.max(items.value.length, DEFAULT_CHILDREN_LIMIT), MAX_CHILDREN_LIMIT);
        const page = await getTrash({ limit: window, offset: 0, ...filterParams() });
        items.value = page.nodes;
        total.value = page.total;
    }

    //------------------------------------------------------------------------------------------------------------------
    // Filters -- each sets its slice of the filter state and reloads from the first page (a filter change resets
    // pagination) without clearing the other filter.
    //------------------------------------------------------------------------------------------------------------------

    async function setTypeFamilies(families : NodeTypeFamily[]) : Promise<void>
    {
        typeFamilies.value = [ ...families ];
        await fetchFirstPage();
    }

    async function setModified(next : ModifiedFilter | null) : Promise<void>
    {
        modified.value = next;
        await fetchFirstPage();
    }

    async function clearFilters() : Promise<void>
    {
        resetFilters();
        await fetchFirstPage();
    }

    async function restore(id : string) : Promise<void>
    {
        await restoreNode(id);
        await refresh();
    }

    // Permanent delete for everyone. The recipients-may-copy opt-in belongs to deleting a live shared file, not to
    // emptying trash, so a purge here never mints deletion offers. Trashed bytes still charge the quota, so the
    // gauge only moves now, at the permanent delete.
    async function purge(id : string) : Promise<void>
    {
        await hardDeleteNode(id);
        await refresh();
        await useSessionStore().refreshProfile()
            .catch(() => undefined);
    }

    // Every one of the caller's trashed roots, gone in one call. The whole listing just emptied, so the window
    // resets directly rather than refetching a now-empty page.
    async function emptyAll() : Promise<void>
    {
        await emptyTrash();
        items.value = [];
        total.value = 0;
        await useSessionStore().refreshProfile()
            .catch(() => undefined);
    }

    return {
        items,
        total,
        loading,
        loadingMore,
        error,
        typeFamilies,
        modified,
        isEmpty,
        hasMore,
        hasActiveFilters,
        filteredEmpty,
        load,
        loadMore,
        refresh,
        setTypeFamilies,
        setModified,
        clearFilters,
        restore,
        purge,
        emptyAll,
    };
});

//----------------------------------------------------------------------------------------------------------------------
