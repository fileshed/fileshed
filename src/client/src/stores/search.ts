//----------------------------------------------------------------------------------------------------------------------
// Search Store
//
// State and orchestration behind the Search view: the caller's most recent query, its results, and the owners facet,
// locations, and sharing they carry. The facet rides the same NodeListResponse shape a folder listing uses, so results
// render owner attribution the identical way, scoped to the hits rather than a whole folder's. A search can never
// surface more hits than the server's candidate cap, and the largest page it will serve is that same cap, so one
// request answers any search in full -- there is nothing here to page. A blank query never reaches the RA -- the page
// calls load only once it has a non-empty term -- so there is no listing-vs-no-query ambiguity to track here.
//
// The mutations a selection can run from here are the drive's, minus the drive: each hits the same node routes and
// then re-runs the search, because the results are the listing that has to settle and the caller's open folder --
// whichever it was -- is not on screen. A copy from here lands in the caller's own root rather than a current folder,
// there being no such thing on this surface.
//----------------------------------------------------------------------------------------------------------------------

import { computed, ref } from 'vue';
import { defineStore } from 'pinia';

import {
    MAX_SEARCH_LIMIT,
    type NodeLocation,
    type NodeResponse,
    type UserSummary,
} from '@fileshed/core';

// Stores
import { useSessionStore } from './session.ts';

// Resource Access
import { copyNode, hardDeleteNode, trashNode } from '../resource-access/nodes.ts';
import { search } from '../resource-access/search.ts';

//----------------------------------------------------------------------------------------------------------------------

export const useSearchStore = defineStore('search', () =>
{
    const q = ref('');
    const nodes = ref<NodeResponse[]>([]);
    const owners = ref<UserSummary[]>([]);
    const locations = ref<Record<string, NodeLocation>>({});
    const total = ref(0);
    const loading = ref(false);
    const error = ref<Error | null>(null);

    const isEmpty = computed(() => !loading.value && error.value === null && nodes.value.length === 0);

    async function load(term : string) : Promise<void>
    {
        q.value = term;
        loading.value = true;
        error.value = null;

        try
        {
            const page = await search(term, { limit: MAX_SEARCH_LIMIT, offset: 0 });
            nodes.value = page.nodes;
            owners.value = page.owners;
            locations.value = page.locations;
            total.value = page.total;
        }
        catch(caught)
        {
            error.value = caught instanceof Error ? caught : new Error('Search failed.');
            nodes.value = [];
            owners.value = [];
            locations.value = {};
            total.value = 0;
        }
        finally
        {
            loading.value = false;
        }
    }

    // Retry re-runs the last query as-is; a new term goes through load instead.
    async function retry() : Promise<void>
    {
        await load(q.value);
    }

    //------------------------------------------------------------------------------------------------------------------
    // Mutations
    //------------------------------------------------------------------------------------------------------------------

    async function trash(id : string) : Promise<void>
    {
        await trashNode(id);
        await retry();
    }

    // A dead link is removed rather than trashed: links carry no trashed_at, so removal is the only way out of a
    // listing for one.
    async function removeDeadLink(id : string) : Promise<void>
    {
        await hardDeleteNode(id);
        await retry();
    }

    // Into the caller's root, the only destination this surface can name. The copy charges their quota, so the gauge
    // refreshes with it.
    async function copy(id : string) : Promise<void>
    {
        await copyNode(id, { parentID: null });
        await retry();
        await useSessionStore()
            .refreshProfile()
            .catch(() => undefined);
    }

    function clear() : void
    {
        q.value = '';
        nodes.value = [];
        owners.value = [];
        locations.value = {};
        total.value = 0;
        error.value = null;
    }

    return {
        q,
        nodes,
        owners,
        locations,
        total,
        loading,
        error,
        isEmpty,
        load,
        retry,
        trash,
        removeDeadLink,
        copy,
        clear,
    };
});

//----------------------------------------------------------------------------------------------------------------------
