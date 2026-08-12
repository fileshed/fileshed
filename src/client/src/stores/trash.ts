//----------------------------------------------------------------------------------------------------------------------
// Trash Store
//
// State and orchestration behind the Trash view: the caller's trashed subtree roots, pulled in chunks until they are
// all in hand, plus the mutations that act on them -- restore (back to its place, or the owner's root when that place
// is gone), permanent delete of one root, and emptying every root at once. Once the listing is whole the Type and
// Modified filters narrow it locally, with no request behind them; past the ceiling they stay the server's. Restore
// and single-root delete re-read the listing; emptying resets it directly, since nothing is left to read. Mutation
// errors propagate to the caller to toast; a failed listing lands in `error` for the surface's retry state.
//----------------------------------------------------------------------------------------------------------------------

import { computed, ref } from 'vue';
import { defineStore } from 'pinia';

import { LISTING_CHUNK_SIZE, type NodeListResponse, type NodeResponse, type NodeTypeFamily } from '@fileshed/core';

// Engines
import { type ListingFilters, listing } from '../engines/listing/index.ts';

// Resource Access
import { emptyTrash, getTrash, hardDeleteNode, restoreNode } from '../resource-access/nodes.ts';

// Stores
import { useSessionStore } from './session.ts';

// Utils
import { type ModifiedFilter, modifiedRange } from '../utils/filterPresets.ts';

//----------------------------------------------------------------------------------------------------------------------

export const useTrashStore = defineStore('trash', () =>
{
    // The rows in hand, in the order the server sent them, and how many the current query has in all. What the surface
    // renders is `items` below.
    const loaded = ref<NodeResponse[]>([]);
    const total = ref(0);

    // Whether the rows in hand came back from a request that carried the filters -- a narrowed listing can be narrowed
    // further locally but never widened, so clearing a filter over one has to go back to the server.
    const serverFiltered = ref(false);

    const loading = ref(false);
    const error = ref<Error | null>(null);

    // The active Type/Modified filters. Per-page-visit, not persisted: a fresh visit (load) drops them, while a
    // mutation's refresh holds them so restoring an item never clears the filter the user set.
    const typeFamilies = ref<NodeTypeFamily[]>([]);
    const modified = ref<ModifiedFilter | null>(null);

    const capped = computed(() => listing.chunks.isCapped(total.value));
    const complete = computed(() => listing.chunks.isComplete(loaded.value.length, total.value));
    const wholeListing = computed(() => complete.value && !serverFiltered.value);

    const hasActiveFilters = computed(() => typeFamilies.value.length > 0 || modified.value !== null);

    function localFilters() : ListingFilters
    {
        const window = modified.value === null ? {} : modifiedRange(modified.value);

        return {
            types: typeFamilies.value,
            ownerID: null,
            after: window.after ?? null,
            before: window.before ?? null,
        };
    }

    // What the surface renders: what has arrived while the listing is still arriving, and once it is whole, the rows
    // the active filters admit. Trash has no sort control -- the server's order stands either way.
    const items = computed<NodeResponse[]>(() =>
    {
        if(!wholeListing.value) { return loaded.value; }

        return listing.filter.filterNodes(loaded.value, localFilters());
    });

    const isEmpty = computed(() => !loading.value && error.value === null && items.value.length === 0);

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

    //------------------------------------------------------------------------------------------------------------------
    // Chunked reading -- `generation` marks which listing a chunk belongs to, so anything still in flight for a
    // listing the user has moved on from lands nowhere.
    //------------------------------------------------------------------------------------------------------------------

    let generation = 0;
    let chunkInFlight = false;

    // A listing held whole filters itself, so its reads go out unfiltered and stay whole; anything else asks the
    // server for the narrowed listing.
    function readsFiltered() : boolean
    {
        return !wholeListing.value && hasActiveFilters.value;
    }

    async function fetchChunk(offset : number, filtered : boolean) : Promise<NodeListResponse>
    {
        return getTrash({ limit: LISTING_CHUNK_SIZE, offset, ...(filtered ? filterParams() : {}) });
    }

    // One chunk from where the rows leave off. An empty chunk answers false as a failure does: the listing shrank
    // under us, and a loop chasing a total it can no longer reach would never end.
    async function pullChunk(token : number) : Promise<boolean>
    {
        if(chunkInFlight || token !== generation) { return false; }

        chunkInFlight = true;
        try
        {
            const page = await fetchChunk(loaded.value.length, serverFiltered.value);
            if(token !== generation || page.nodes.length === 0) { return false; }

            loaded.value = [ ...loaded.value, ...page.nodes ];
            total.value = page.total;

            return true;
        }
        catch
        {
            // A chunk that fails leaves the listing short rather than replacing what is on screen with an error state.
            return false;
        }
        finally
        {
            chunkInFlight = false;
        }
    }

    async function fillRest(token : number) : Promise<void>
    {
        while(token === generation && listing.chunks.shouldPrefetch(loaded.value.length, total.value))
        {
            // The next offset is only known once the chunk before it lands, so the reads are necessarily sequential.
            // eslint-disable-next-line no-await-in-loop
            const landed = await pullChunk(token);
            if(!landed) { return; }
        }
    }

    // How far down the listing the surface has rendered: one still short of its total pulls the next chunk before the
    // user arrives at the end of what is loaded.
    function reachedIndex(index : number) : void
    {
        if(listing.chunks.reachesEnd(index, loaded.value.length, total.value)) { void pullChunk(generation); }
    }

    function adopt(page : NodeListResponse, filtered : boolean) : void
    {
        loaded.value = page.nodes;
        total.value = page.total;
        serverFiltered.value = filtered;
    }

    async function fetchListing() : Promise<void>
    {
        const filtered = readsFiltered();
        const token = ++generation;

        loading.value = true;
        error.value = null;

        try
        {
            const page = await fetchChunk(0, filtered);
            if(token !== generation) { return; }

            adopt(page, filtered);
        }
        catch(caught)
        {
            if(token !== generation) { return; }

            error.value = caught instanceof Error ? caught : new Error('Failed to load the trash.');
            loaded.value = [];
            total.value = 0;
        }
        finally
        {
            if(token === generation) { loading.value = false; }
        }

        await fillRest(token);
    }

    // A fresh visit to the trash: filters reset, then the listing loads unfiltered.
    async function load() : Promise<void>
    {
        resetFilters();
        await fetchListing();
    }

    // Re-read the trash, holding the filters in force, so a mutation reflects without dropping the active filter or
    // dropping the listing back to a spinner.
    async function refresh() : Promise<void>
    {
        const filtered = readsFiltered();
        const token = ++generation;

        const page = await fetchChunk(0, filtered);
        if(token !== generation) { return; }

        adopt(page, filtered);

        await fillRest(token);
    }

    //------------------------------------------------------------------------------------------------------------------
    // Filters -- each sets its slice of the filter state, then narrows the listing in hand or re-reads it narrowed,
    // without clearing the other filter.
    //------------------------------------------------------------------------------------------------------------------

    async function applyFilters() : Promise<void>
    {
        if(wholeListing.value) { return; }

        await fetchListing();
    }

    async function setTypeFamilies(families : NodeTypeFamily[]) : Promise<void>
    {
        typeFamilies.value = [ ...families ];
        await applyFilters();
    }

    async function setModified(next : ModifiedFilter | null) : Promise<void>
    {
        modified.value = next;
        await applyFilters();
    }

    async function clearFilters() : Promise<void>
    {
        resetFilters();
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
        await useSessionStore().refreshProfile()
            .catch(() => undefined);
    }

    // Every one of the caller's trashed roots, gone in one call. The whole listing just emptied, so the rows reset
    // directly rather than re-reading a listing that is now empty.
    async function emptyAll() : Promise<void>
    {
        await emptyTrash();
        generation += 1;
        loaded.value = [];
        total.value = 0;
        await useSessionStore().refreshProfile()
            .catch(() => undefined);
    }

    return {
        items,
        total,
        loading,
        error,
        typeFamilies,
        modified,
        isEmpty,
        capped,
        complete,
        hasActiveFilters,
        filteredEmpty,
        load,
        reachedIndex,
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
