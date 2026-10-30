//----------------------------------------------------------------------------------------------------------------------
// Trash Store
//
// Once the listing is whole the Type and Modified filters narrow it locally, with no request behind them; past the
// ceiling they stay the server's.
//----------------------------------------------------------------------------------------------------------------------

import { computed, ref } from 'vue';
import { defineStore } from 'pinia';

import { LISTING_CHUNK_SIZE, type NodeListResponse, type NodeResponse, type NodeTypeFamily } from '@fileshed/core';

// Engines
import { type ModifiedFilter, listing } from '../engines/listing/index.ts';

// Resource Access
import { emptyTrash, hardDeleteNode, listTrash, restoreNode } from '../resource-access/nodes.ts';

// Stores
import { createChunkedListing } from './chunkedListing.ts';
import { createListingFilters } from './listingFilters.ts';
import { useSessionStore } from './session.ts';

//----------------------------------------------------------------------------------------------------------------------

export const useTrashStore = defineStore('trash', () =>
{
    const loading = ref(false);
    const error = ref<Error | null>(null);

    // The active Type/Modified filters. Per-page-visit, not persisted: a fresh visit (load) drops them, while a
    // mutation's refresh holds them so restoring an item never clears the filter the user set.
    const filters = createListingFilters();

    //------------------------------------------------------------------------------------------------------------------

    async function fetchChunk(offset : number, filtered : boolean) : Promise<NodeListResponse>
    {
        return listTrash({ limit: LISTING_CHUNK_SIZE, offset, ...(filtered ? filters.query() : {}) });
    }

    // The rows in hand and the chunk reads that fill them.
    const rows = createChunkedListing({ fetchChunk });

    // What the surface renders: what has arrived while the listing is still arriving, and once it is whole, the rows
    // the active filters admit. Trash has no sort control -- the server's order stands either way.
    const items = computed<NodeResponse[]>(() =>
    {
        if(!rows.whole.value) { return rows.loaded.value; }

        return listing.filter.filterNodes(rows.loaded.value, filters.current());
    });

    const isEmpty = computed(() => !loading.value && error.value === null && items.value.length === 0);

    // An empty result WITH an active filter is a distinct surface state from a genuinely empty trash.
    const filteredEmpty = computed(() => isEmpty.value && filters.active.value);

    async function fetchListing() : Promise<void>
    {
        const filtered = rows.shouldFilterOnServer(filters.active.value);
        const token = rows.begin();

        loading.value = true;
        error.value = null;

        try
        {
            if(!await rows.replaceWithFirstChunk(token, filtered)) { return; }
        }
        catch(caught)
        {
            if(!rows.isCurrent(token)) { return; }

            error.value = caught instanceof Error ? caught : new Error('Failed to load the trash.');
            rows.clear();
        }
        finally
        {
            if(rows.isCurrent(token)) { loading.value = false; }
        }

        await rows.fillRest(token);
    }

    // A fresh visit to the trash: filters reset, then the listing loads unfiltered.
    async function load() : Promise<void>
    {
        filters.reset();
        await fetchListing();
    }

    // Re-read the trash, holding the filters in force, so a mutation reflects without dropping the active filter or
    // dropping the listing back to a spinner.
    async function refresh() : Promise<void>
    {
        await rows.refresh(rows.shouldFilterOnServer(filters.active.value));
    }

    //------------------------------------------------------------------------------------------------------------------
    // Filters -- each sets its slice of the filter state, then narrows the listing in hand or re-reads it narrowed,
    // without clearing the other filter.
    //------------------------------------------------------------------------------------------------------------------

    async function applyFilters() : Promise<void>
    {
        if(rows.whole.value) { return; }

        await fetchListing();
    }

    async function setTypeFamilies(families : NodeTypeFamily[]) : Promise<void>
    {
        filters.typeFamilies.value = [ ...families ];
        await applyFilters();
    }

    async function setModified(next : ModifiedFilter | null) : Promise<void>
    {
        filters.modified.value = next;
        await applyFilters();
    }

    async function clearFilters() : Promise<void>
    {
        filters.reset();
        await applyFilters();
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
        await useSessionStore().refreshProfile();
    }

    // Every one of the caller's trashed roots, gone in one call. The whole listing just emptied, so the rows reset
    // directly rather than re-reading a listing that is now empty.
    async function emptyAll() : Promise<void>
    {
        await emptyTrash();
        rows.begin();
        rows.clear();
        await useSessionStore().refreshProfile();
    }

    return {
        items,
        total: rows.total,
        loading,
        error,
        typeFamilies: filters.typeFamilies,
        modified: filters.modified,
        isEmpty,
        capped: rows.capped,
        complete: rows.complete,
        hasActiveFilters: filters.active,
        filteredEmpty,
        load,
        reachedIndex: rows.reachedIndex,
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
