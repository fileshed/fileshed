//----------------------------------------------------------------------------------------------------------------------
// Listing Engine
//
// Everything a chunked, virtualized listing decides without touching the network: how much of it is worth pulling,
// what order it reads in once it is whole, and which of its rows a filter admits. Per-domain engines compose into one
// facade, so a caller reaches for `listing.chunks.isComplete` rather than importing the chunk file directly.
//----------------------------------------------------------------------------------------------------------------------

// Listing
import { isCapped, isComplete, reachesEnd, shouldPrefetch } from './chunks.ts';
import { familyOf, filterNodes } from './filter.ts';
import { sortNodes } from './order.ts';

//----------------------------------------------------------------------------------------------------------------------

export const listing = {
    chunks: {
        isCapped,
        isComplete,
        shouldPrefetch,
        reachesEnd,
    },
    filter: {
        familyOf,
        filterNodes,
    },
    order: {
        sortNodes,
    },
} as const;

//----------------------------------------------------------------------------------------------------------------------
// Re-exports
//----------------------------------------------------------------------------------------------------------------------

export { isCapped, isComplete, shouldPrefetch, reachesEnd } from './chunks.ts';
export { type ListingFilters, familyOf, filterNodes } from './filter.ts';
export { sortNodes } from './order.ts';

//----------------------------------------------------------------------------------------------------------------------
