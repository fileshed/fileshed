//----------------------------------------------------------------------------------------------------------------------
// Shared Store
//
// State and orchestration behind the Shared with me view: the caller's active incoming grants, each carrying its target
// for display, its role, and whether the caller has already placed a link to it. The listing is a single unpaginated
// read (every active grant), so there is no load-more. Three recipient mutations act on an entry -- save a copy of a
// shared file into My Files, place a link to it in a folder of the caller's choosing, and leave a share -- each calling
// the RA then refetching so the surface reflects the change. Mutation errors propagate to the caller to toast; a failed
// listing lands in `error` for the surface's retry.
//----------------------------------------------------------------------------------------------------------------------

import { computed, ref } from 'vue';
import { defineStore } from 'pinia';

import type { NodeTypeFamily, SharedWithMeEntry } from '@fileshed/core';

// Resource Access
import { copyNode, createNode } from '../resource-access/nodes.ts';
import { leaveShare, sharedWithMe } from '../resource-access/shares.ts';

// Utils
import { type ModifiedFilter, modifiedRange } from '../utils/filterPresets.ts';

//----------------------------------------------------------------------------------------------------------------------

export const useSharedStore = defineStore('shared', () =>
{
    const entries = ref<SharedWithMeEntry[]>([]);
    const loading = ref(false);
    const error = ref<Error | null>(null);

    // The active Type/Modified filters, applied server-side against each share's target. Per-page-visit, not
    // persisted: a fresh visit (load) drops them, while a mutation's refetch holds them.
    const typeFamilies = ref<NodeTypeFamily[]>([]);
    const modified = ref<ModifiedFilter | null>(null);

    const isEmpty = computed(() => !loading.value && error.value === null && entries.value.length === 0);
    const hasActiveFilters = computed(() => typeFamilies.value.length > 0 || modified.value !== null);

    // An empty listing WITH an active filter is a distinct surface state from nothing being shared at all.
    const filteredEmpty = computed(() => isEmpty.value && hasActiveFilters.value);

    // The current filters as a shared-with-me query fragment: an empty type selection and an absent date window are
    // dropped so the server reads them as unfiltered.
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

    async function refresh() : Promise<void>
    {
        entries.value = (await sharedWithMe(filterParams())).entries;
    }

    async function fetchListing() : Promise<void>
    {
        loading.value = true;
        error.value = null;

        try
        {
            await refresh();
        }
        catch(caught)
        {
            error.value = caught instanceof Error ? caught : new Error('Failed to load your shared items.');
            entries.value = [];
        }
        finally
        {
            loading.value = false;
        }
    }

    // A fresh visit: filters reset, then the listing loads unfiltered.
    async function load() : Promise<void>
    {
        resetFilters();
        await fetchListing();
    }

    //------------------------------------------------------------------------------------------------------------------
    // Filters -- each sets its slice of the filter state and re-queries without clearing the other filter.
    //------------------------------------------------------------------------------------------------------------------

    async function setTypeFamilies(families : NodeTypeFamily[]) : Promise<void>
    {
        typeFamilies.value = [ ...families ];
        await fetchListing();
    }

    async function setModified(next : ModifiedFilter | null) : Promise<void>
    {
        modified.value = next;
        await fetchListing();
    }

    async function clearFilters() : Promise<void>
    {
        resetFilters();
        await fetchListing();
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
        typeFamilies,
        modified,
        isEmpty,
        hasActiveFilters,
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
