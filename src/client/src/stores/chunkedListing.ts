//----------------------------------------------------------------------------------------------------------------------
// Chunked Listing
//
// A listing that arrives one chunk at a time. Every read from the top starts a generation; a chunk still in flight for
// an earlier generation lands nowhere and never holds up the current one.
//----------------------------------------------------------------------------------------------------------------------

import { type ComputedRef, type Ref, computed, ref } from 'vue';

import type { NodeListResponse, NodeResponse } from '@fileshed/core';

// Engines
import { listing } from '../engines/listing/index.ts';

//----------------------------------------------------------------------------------------------------------------------

export interface ChunkedListingSource
{
    // One chunk from `offset`, narrowed on the server when `filtered` is set.
    fetchChunk(offset : number, filtered : boolean) : Promise<NodeListResponse>;

    // Every page that lands, the first and each later one, after its rows are in.
    onPage ?: (page : NodeListResponse) => void;
}

export interface ChunkedListing
{
    // The rows in hand, in the order the server sent them, and how many the current query has in all.
    loaded : Ref<NodeResponse[]>;
    total : Ref<number>;

    // Whether the rows in hand came from a read that carried the filters. A narrowed listing can be narrowed further
    // locally but never widened, so clearing a filter over one has to go back to the server.
    serverFiltered : Ref<boolean>;

    // Past the ceiling a listing is too big to hold whole: it loads as the viewport reaches for it, and its order and
    // filtering stay the server's. `complete` is every row of the current query in hand; `whole` is that AND nothing
    // having narrowed it on the way in, which is what makes a filter change a local narrowing.
    capped : ComputedRef<boolean>;
    complete : ComputedRef<boolean>;
    whole : ComputedRef<boolean>;

    begin() : number;
    isCurrent(token : number) : boolean;

    // A listing held whole filters itself, so its reads go out unfiltered and stay whole. Anything else leaves
    // filtering to the server, the only side that can narrow rows the client has never seen.
    shouldFilterOnServer(activeFilters : boolean) : boolean;

    // Replaces the rows with the first chunk, answering false when the generation was superseded before it landed.
    replaceWithFirstChunk(token : number, filtered : boolean) : Promise<boolean>;

    // Pulls the rest behind the first chunk, so a listing within the ceiling is whole moments after it paints.
    fillRest(token : number) : Promise<void>;

    // Re-reads from the top with no loading state, so a mutation shows without the listing dropping to a spinner.
    refresh(filtered : boolean) : Promise<void>;

    // How far down the surface has rendered. A listing short of its total pulls the next chunk before the reader
    // arrives at the end of what is loaded -- what carries a listing past the ceiling, and what picks a fill back up
    // after a chunk failed.
    reachedIndex(index : number) : void;

    clear() : void;
}

//----------------------------------------------------------------------------------------------------------------------

export function createChunkedListing(source : ChunkedListingSource) : ChunkedListing
{
    const loaded = ref<NodeResponse[]>([]);
    const total = ref(0);
    const serverFiltered = ref(false);

    const capped = computed(() => listing.chunks.isCapped(total.value));
    const complete = computed(() => listing.chunks.isComplete(loaded.value.length, total.value));
    const whole = computed(() => complete.value && !serverFiltered.value);

    let generation = 0;

    // The generation whose chunk is on the wire. Only that generation waits for it; a later one reads on regardless.
    let inFlightFor : number | null = null;

    function begin() : number
    {
        generation += 1;

        return generation;
    }

    function isCurrent(token : number) : boolean
    {
        return token === generation;
    }

    function shouldFilterOnServer(activeFilters : boolean) : boolean
    {
        return !whole.value && activeFilters;
    }

    async function replaceWithFirstChunk(token : number, filtered : boolean) : Promise<boolean>
    {
        const page = await source.fetchChunk(0, filtered);
        if(token !== generation) { return false; }

        loaded.value = page.nodes;
        total.value = page.total;
        serverFiltered.value = filtered;
        source.onPage?.(page);

        return true;
    }

    // One chunk from where the rows leave off. A chunk that comes back empty answers false as a failure does: the
    // listing shrank under us, and a loop chasing a total it can no longer reach would never end.
    async function appendNextChunk(token : number) : Promise<boolean>
    {
        if(inFlightFor === token || token !== generation) { return false; }

        inFlightFor = token;
        try
        {
            const page = await source.fetchChunk(loaded.value.length, serverFiltered.value);
            if(token !== generation || page.nodes.length === 0) { return false; }

            loaded.value = [ ...loaded.value, ...page.nodes ];
            total.value = page.total;
            source.onPage?.(page);

            return true;
        }
        catch
        {
            // A chunk that fails leaves the listing short rather than replacing what is on screen with an error state.
            return false;
        }
        finally
        {
            if(inFlightFor === token) { inFlightFor = null; }
        }
    }

    async function fillRest(token : number) : Promise<void>
    {
        while(token === generation && listing.chunks.shouldPrefetch(loaded.value.length, total.value))
        {
            // The next offset is only known once the chunk before it lands, so the reads are necessarily sequential.
            // eslint-disable-next-line no-await-in-loop
            const landed = await appendNextChunk(token);
            if(!landed) { return; }
        }
    }

    async function refresh(filtered : boolean) : Promise<void>
    {
        const token = begin();

        if(await replaceWithFirstChunk(token, filtered)) { await fillRest(token); }
    }

    function reachedIndex(index : number) : void
    {
        if(listing.chunks.reachesEnd(index, loaded.value.length, total.value)) { void appendNextChunk(generation); }
    }

    function clear() : void
    {
        loaded.value = [];
        total.value = 0;
    }

    return {
        loaded,
        total,
        serverFiltered,
        capped,
        complete,
        whole,
        begin,
        isCurrent,
        shouldFilterOnServer,
        replaceWithFirstChunk,
        fillRest,
        refresh,
        reachedIndex,
        clear,
    };
}

//----------------------------------------------------------------------------------------------------------------------
