//----------------------------------------------------------------------------------------------------------------------
// Search Store
//
// One request answers any search in full: a search never surfaces more hits than the server's candidate cap, and the
// largest page the server serves is that same cap. The page calls load only with a non-empty term.
//
// Mutations from a selection hit the same node routes as the drive and then re-run the search, because the results are
// the listing on screen, not any folder. A copy lands in the caller's own root, since this surface has no current
// folder.
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

    // Two searches typed in quick succession can answer in either order, and a clear can come while one is on the
    // wire. Only the latest read lands.
    let generation = 0;

    async function load(term : string) : Promise<void>
    {
        const token = ++generation;
        q.value = term;
        loading.value = true;
        error.value = null;

        try
        {
            const page = await search(term, { limit: MAX_SEARCH_LIMIT, offset: 0 });
            if(token !== generation) { return; }

            nodes.value = page.nodes;
            owners.value = page.owners;
            locations.value = page.locations;
            total.value = page.total;
        }
        catch(caught)
        {
            if(token !== generation) { return; }

            error.value = caught instanceof Error ? caught : new Error('Search failed.');
            nodes.value = [];
            owners.value = [];
            locations.value = {};
            total.value = 0;
        }
        finally
        {
            if(token === generation) { loading.value = false; }
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
        await useSessionStore().refreshProfile();
    }

    function clear() : void
    {
        generation += 1;
        loading.value = false;
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
