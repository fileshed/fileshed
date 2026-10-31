//----------------------------------------------------------------------------------------------------------------------
// Listing Filters
//----------------------------------------------------------------------------------------------------------------------

import { type ComputedRef, type Ref, computed, ref } from 'vue';

import type { NodeTypeFamily, UserSummary } from '@fileshed/core';

// Engines
import {
    type ListingFilterQuery,
    type ListingFilters,
    type ModifiedFilter,
    listing,
} from '../engines/listing/index.ts';

//----------------------------------------------------------------------------------------------------------------------

export interface ListingFilterState
{
    typeFamilies : Ref<NodeTypeFamily[]>;
    owner : Ref<UserSummary | null>;
    modified : Ref<ModifiedFilter | null>;

    active : ComputedRef<boolean>;

    // The filters as the listing engine states them, a preset's window resolved against the clock now.
    current() : ListingFilters;
    query() : ListingFilterQuery;
    reset() : void;
}

//----------------------------------------------------------------------------------------------------------------------

export function createListingFilters() : ListingFilterState
{
    const typeFamilies = ref<NodeTypeFamily[]>([]);
    const owner = ref<UserSummary | null>(null);
    const modified = ref<ModifiedFilter | null>(null);

    const active = computed(() => typeFamilies.value.length > 0 || owner.value !== null || modified.value !== null);

    function current() : ListingFilters
    {
        const window = modified.value === null ? {} : listing.presets.modifiedRange(modified.value);

        return {
            types: typeFamilies.value,
            ownerID: owner.value?.id ?? null,
            after: window.after ?? null,
            before: window.before ?? null,
        };
    }

    function query() : ListingFilterQuery
    {
        return listing.filter.filterQuery(current());
    }

    function reset() : void
    {
        typeFamilies.value = [];
        owner.value = null;
        modified.value = null;
    }

    return { typeFamilies, owner, modified, active, current, query, reset };
}

//----------------------------------------------------------------------------------------------------------------------
