//----------------------------------------------------------------------------------------------------------------------
// Listing Metrics
//
// The viewport width behind a virtualized listing's geometry. A scroller has to be told its item size in pixels, so
// the tiers the grid and list used to express in Tailwind classes are read here instead and answered as numbers.
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
