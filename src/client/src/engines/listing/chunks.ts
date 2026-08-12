//----------------------------------------------------------------------------------------------------------------------
// Listing Chunks
//
// What a partly-loaded listing may do next: whether more of it is worth pulling on its own, whether enough is in hand
// to order it without asking the server, and whether the rendered range has come close enough to the loaded edge to
// want the next chunk. Counts only -- no rows reach here.
//----------------------------------------------------------------------------------------------------------------------

import { LISTING_FETCH_MARGIN, MAX_COMPLETE_LISTING } from '@fileshed/core';

//----------------------------------------------------------------------------------------------------------------------

// A listing too big to hold whole. It loads as the viewport reaches for it, and its ordering stays the server's --
// the only side that can order rows the client has never seen.
export function isCapped(total : number) : boolean
{
    return total > MAX_COMPLETE_LISTING;
}

// Every row the current query answers with is in hand, and the listing is one worth holding whole: sorting is a local
// array operation from here, with no request behind it.
export function isComplete(loaded : number, total : number) : boolean
{
    return !isCapped(total) && loaded >= total;
}

// Whether another chunk should go out unprompted. A listing within the ceiling keeps pulling until it is whole, so the
// first chunk paints and the rest arrives behind it.
export function shouldPrefetch(loaded : number, total : number) : boolean
{
    return !isCapped(total) && loaded < total;
}

// Whether the rendered range has reached far enough that the next chunk is already wanted. This is what carries a
// capped listing as the user scrolls, and what picks a fill back up after a chunk failed.
export function reachesEnd(lastRenderedIndex : number, loaded : number, total : number) : boolean
{
    return loaded < total && lastRenderedIndex >= loaded - LISTING_FETCH_MARGIN;
}

//----------------------------------------------------------------------------------------------------------------------
