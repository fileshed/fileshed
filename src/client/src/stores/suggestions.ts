//----------------------------------------------------------------------------------------------------------------------
// Suggestions Store
//
// The live results behind the top bar's search box. Typing settles before anything is asked of the server, and every
// request carries an abort signal: a keystroke supersedes the one before it, so only the newest query's answer is ever
// allowed to reach the dropdown. Without that, a slow early request landing after a fast later one would leave the
// caller reading suggestions for a word they have already finished typing.
//
// This holds the DATA. Whether the dropdown is showing, and which row is highlighted, belong to the box itself.
//----------------------------------------------------------------------------------------------------------------------

import { ref } from 'vue';
import { defineStore } from 'pinia';

import {
    MIN_SUGGEST_CHARS,
    type NodeLocation,
    type NodeResponse,
    SUGGEST_DEBOUNCE_MS,
    SUGGEST_LIMIT,
} from '@fileshed/core';

// Resource Access
import { search } from '../resource-access/search.ts';

//----------------------------------------------------------------------------------------------------------------------

export const useSuggestionsStore = defineStore('suggestions', () =>
{
    const term = ref('');
    const nodes = ref<NodeResponse[]>([]);
    const locations = ref<Record<string, NodeLocation>>({});
    const loading = ref(false);

    let timer : ReturnType<typeof setTimeout> | null = null;
    let inFlight : AbortController | null = null;

    // Drop whatever is pending or in the air. The abandoned request's own resolution is discarded by the ownership
    // check in run(), so nothing it returns can land after this.
    function cancel() : void
    {
        if(timer !== null)
        {
            clearTimeout(timer);
            timer = null;
        }

        if(inFlight !== null)
        {
            inFlight.abort();
            inFlight = null;
        }
    }

    function forget() : void
    {
        nodes.value = [];
        locations.value = {};
    }

    async function run(query : string) : Promise<void>
    {
        const controller = new AbortController();
        inFlight = controller;
        loading.value = true;

        try
        {
            const page = await search(query, { limit: SUGGEST_LIMIT, signal: controller.signal });

            if(inFlight !== controller) { return; }

            nodes.value = page.nodes;
            locations.value = page.locations;
        }
        catch
        {
            // An abort and a real failure look the same from here, and both mean the same thing to the dropdown:
            // there is nothing current to show. A superseded request leaves the newer one's results alone.
            if(inFlight !== controller) { return; }

            forget();
        }
        finally
        {
            if(inFlight === controller)
            {
                inFlight = null;
                loading.value = false;
            }
        }
    }

    // Ask for suggestions on `raw`, once the typing settles. A term below the floor clears instead of querying -- one
    // or two characters match nearly everything.
    function suggest(raw : string) : void
    {
        const query = raw.trim();
        term.value = query;
        cancel();

        if(query.length < MIN_SUGGEST_CHARS)
        {
            forget();
            loading.value = false;
            return;
        }

        timer = setTimeout(() =>
        {
            timer = null;
            void run(query);
        }, SUGGEST_DEBOUNCE_MS);
    }

    function clear() : void
    {
        cancel();
        term.value = '';
        forget();
        loading.value = false;
    }

    return { term, nodes, locations, loading, suggest, clear };
});

//----------------------------------------------------------------------------------------------------------------------
