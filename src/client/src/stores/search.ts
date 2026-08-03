//----------------------------------------------------------------------------------------------------------------------
// Search Store
//
// State and orchestration behind the Search view: the caller's most recent query, its results loaded a page at a
// time, and the owners facet and locations each page carries. The facet rides the same NodeListResponse shape a folder
// listing uses, so a page renders owner attribution the identical way, scoped to that page's own hits rather than a
// whole folder's. A blank query never reaches the RA -- the page calls load only once it has a non-empty term -- so
// there is no listing-vs-no-query ambiguity to track here.
//----------------------------------------------------------------------------------------------------------------------

import { computed, ref } from 'vue';
import { defineStore } from 'pinia';

import {
    DEFAULT_SEARCH_LIMIT,
    type NodeLocation,
    type NodeResponse,
    type UserSummary,
} from '@fileshed/core';

// Resource Access
import { search } from '../resource-access/search.ts';

//----------------------------------------------------------------------------------------------------------------------

// Unlike a folder listing's facet (the whole folder, every page), search's facet is scoped to each response's own
// page, so a later page's owners merge into the running set rather than replacing it -- otherwise an earlier page's
// owner would drop out of attribution the moment a further page loads.
function mergeOwners(existing : readonly UserSummary[], incoming : readonly UserSummary[]) : UserSummary[]
{
    const merged = new Map(existing.map((owner) => [ owner.id, owner ]));
    for(const owner of incoming) { merged.set(owner.id, owner); }

    return [ ...merged.values() ];
}

//----------------------------------------------------------------------------------------------------------------------

export const useSearchStore = defineStore('search', () =>
{
    const q = ref('');
    const nodes = ref<NodeResponse[]>([]);
    const owners = ref<UserSummary[]>([]);
    const locations = ref<Record<string, NodeLocation>>({});
    const total = ref(0);
    const loading = ref(false);
    const loadingMore = ref(false);
    const error = ref<Error | null>(null);

    const hasMore = computed(() => nodes.value.length < total.value);
    const isEmpty = computed(() => !loading.value && error.value === null && nodes.value.length === 0);

    async function load(term : string) : Promise<void>
    {
        q.value = term;
        loading.value = true;
        error.value = null;

        try
        {
            const page = await search(term, { limit: DEFAULT_SEARCH_LIMIT, offset: 0 });
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

    async function loadMore() : Promise<void>
    {
        if(loadingMore.value || !hasMore.value) { return; }

        loadingMore.value = true;
        try
        {
            const page = await search(q.value, { limit: DEFAULT_SEARCH_LIMIT, offset: nodes.value.length });
            nodes.value = [ ...nodes.value, ...page.nodes ];
            owners.value = mergeOwners(owners.value, page.owners);
            locations.value = { ...locations.value, ...page.locations };
            total.value = page.total;
        }
        finally
        {
            loadingMore.value = false;
        }
    }

    // Retry re-runs the last query as-is; a new term goes through load instead.
    async function retry() : Promise<void>
    {
        await load(q.value);
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
        loadingMore,
        error,
        hasMore,
        isEmpty,
        load,
        loadMore,
        retry,
        clear,
    };
});

//----------------------------------------------------------------------------------------------------------------------
