//----------------------------------------------------------------------------------------------------------------------
// Shared Store
//----------------------------------------------------------------------------------------------------------------------

import { computed, ref } from 'vue';
import { defineStore } from 'pinia';

import type { NodeTypeFamily, SharedWithMeEntry } from '@fileshed/core';

// Resource Access
import { copyNode, createNode } from '../resource-access/nodes.ts';
import { leaveShare, listSharedWithMe } from '../resource-access/shares.ts';

// Engines
import type { ModifiedFilter } from '../engines/listing/index.ts';

// Stores
import { createListingFilters } from './listingFilters.ts';

//----------------------------------------------------------------------------------------------------------------------

export const useSharedStore = defineStore('shared', () =>
{
    const entries = ref<SharedWithMeEntry[]>([]);
    const loading = ref(false);
    const error = ref<Error | null>(null);

    // The active Type/Modified filters, applied server-side against each share's target. Per-page-visit, not
    // persisted: a fresh visit (load) drops them, while a mutation's refetch holds them.
    const filters = createListingFilters();

    const isEmpty = computed(() => !loading.value && error.value === null && entries.value.length === 0);

    // An empty listing WITH an active filter is a distinct surface state from nothing being shared at all.
    const filteredEmpty = computed(() => isEmpty.value && filters.active.value);

    // Each filter change re-reads, so an older and less narrowed read can answer after a newer one. Only the latest
    // read lands.
    let generation = 0;

    async function readEntries(token : number) : Promise<void>
    {
        const read = await listSharedWithMe(filters.query());
        if(token === generation) { entries.value = read.entries; }
    }

    async function refresh() : Promise<void>
    {
        await readEntries(++generation);
    }

    async function loadListing() : Promise<void>
    {
        const token = ++generation;
        loading.value = true;
        error.value = null;

        try
        {
            await readEntries(token);
        }
        catch(caught)
        {
            if(token !== generation) { return; }

            error.value = caught instanceof Error ? caught : new Error('Failed to load your shared items.');
            entries.value = [];
        }
        finally
        {
            if(token === generation) { loading.value = false; }
        }
    }

    // A fresh visit: filters reset, then the listing loads unfiltered.
    async function load() : Promise<void>
    {
        filters.reset();
        await loadListing();
    }

    //------------------------------------------------------------------------------------------------------------------
    // Filters -- each sets its slice of the filter state and re-queries without clearing the other filter.
    //------------------------------------------------------------------------------------------------------------------

    async function setTypeFamilies(families : NodeTypeFamily[]) : Promise<void>
    {
        filters.typeFamilies.value = [ ...families ];
        await loadListing();
    }

    async function setModified(next : ModifiedFilter | null) : Promise<void>
    {
        filters.modified.value = next;
        await loadListing();
    }

    async function clearFilters() : Promise<void>
    {
        filters.reset();
        await loadListing();
    }

    // Save a copy of a shared file into My Files (root), a fresh node the caller owns referencing the same content.
    async function copy(targetID : string) : Promise<void>
    {
        await copyNode(targetID, { parentID: null });
        await refresh();
    }

    // Add to my files: place a link to the shared target in a folder the caller owns, root included. Placement is
    // independent of the grant -- it does not touch the share, and the same target may be placed again elsewhere later.
    async function addToFiles(targetID : string, parentID : string | null) : Promise<void>
    {
        await createNode({ type: 'link', parentID, targetNodeID: targetID });
        await refresh();
    }

    // Leave a share: the caller drops their own grant. Any links they placed go dead and persist as stubs -- cleaning
    // those up is a separate action, not this call.
    async function leave(shareID : string) : Promise<void>
    {
        await leaveShare(shareID);
        await refresh();
    }

    return {
        entries,
        loading,
        error,
        typeFamilies: filters.typeFamilies,
        modified: filters.modified,
        isEmpty,
        hasActiveFilters: filters.active,
        filteredEmpty,
        load,
        refresh,
        setTypeFamilies,
        setModified,
        clearFilters,
        copy,
        addToFiles,
        leave,
    };
});

//----------------------------------------------------------------------------------------------------------------------
