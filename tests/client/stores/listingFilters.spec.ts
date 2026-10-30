//----------------------------------------------------------------------------------------------------------------------
// Listing Filters
//----------------------------------------------------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';

// Stores
import { createListingFilters } from '@client/stores/listingFilters.ts';

//----------------------------------------------------------------------------------------------------------------------

describe('createListingFilters', () =>
{
    it('counts any one filter as active, and none once they are reset', () =>
    {
        const filters = createListingFilters();
        expect(filters.active.value).toBe(false);

        filters.modified.value = { kind: 'preset', preset: 'today' };
        expect(filters.active.value).toBe(true);

        filters.reset();
        expect(filters.active.value).toBe(false);
        expect(filters.modified.value).toBeNull();
    });

    it('states the choices as the listing engine filters by them', () =>
    {
        const filters = createListingFilters();
        filters.typeFamilies.value = [ 'documents' ];
        filters.owner.value = { id: 'u2', name: 'Grace Hopper', email: 'grace@example.com', image: null };
        filters.modified.value = {
            kind: 'range',
            after: '2026-06-01T00:00:00.000Z',
            before: '2026-07-01T00:00:00.000Z',
        };

        expect(filters.current()).toEqual({
            types: [ 'documents' ],
            ownerID: 'u2',
            after: '2026-06-01T00:00:00.000Z',
            before: '2026-07-01T00:00:00.000Z',
        });
    });
});

//----------------------------------------------------------------------------------------------------------------------
