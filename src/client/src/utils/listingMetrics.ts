//----------------------------------------------------------------------------------------------------------------------
// Listing Metrics
//
// A scroller has to be told its item size in pixels, so the grid and list breakpoint tiers are computed here as numbers
// rather than expressed as Tailwind classes.
//----------------------------------------------------------------------------------------------------------------------

import { type ComputedRef, computed } from 'vue';
import { useWindowSize } from '@vueuse/core';

import { listingGridColumns, listingRowHeight } from '@fileshed/core';

//----------------------------------------------------------------------------------------------------------------------

export interface ListingMetrics
{
    columns : ComputedRef<number>;
    rowHeight : ComputedRef<number>;
}

export function useListingMetrics() : ListingMetrics
{
    const { width } = useWindowSize();

    return {
        columns: computed(() => listingGridColumns(width.value)),
        rowHeight: computed(() => listingRowHeight(width.value)),
    };
}

//----------------------------------------------------------------------------------------------------------------------
