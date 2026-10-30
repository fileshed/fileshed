//----------------------------------------------------------------------------------------------------------------------
// Listing Engine
//
// Callers reach for `listing.chunks.isComplete` through this facade rather than importing a domain file directly.
//----------------------------------------------------------------------------------------------------------------------

// Listing
import { isCapped, isComplete, reachesEnd, shouldPrefetch } from './chunks.ts';
import { familyOf, filterNodes, filterQuery } from './filter.ts';
import {
    MODIFIED_PRESET_LABELS,
    modifiedFilterSummary,
    modifiedPresets,
    modifiedRange,
    ownerChipVisible,
    ownerFilterSummary,
} from './filterPresets.ts';
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
        filterQuery,
    },
    presets: {
        MODIFIED_PRESET_LABELS,
        modifiedPresets,
        modifiedRange,
        modifiedFilterSummary,
        ownerChipVisible,
        ownerFilterSummary,
    },
    order: {
        sortNodes,
    },
} as const;

//----------------------------------------------------------------------------------------------------------------------

export type { ListingFilterQuery, ListingFilters } from './filter.ts';
export type { ModifiedFilter, ModifiedPreset } from './filterPresets.ts';

//----------------------------------------------------------------------------------------------------------------------
