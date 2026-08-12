//----------------------------------------------------------------------------------------------------------------------
// Listing Geometry
//----------------------------------------------------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';

import {
    LISTING_ROW_HEIGHT,
    LISTING_ROW_HEIGHT_STACKED,
    listingGridColumns,
    listingRowHeight,
} from '@fileshed/core';

//----------------------------------------------------------------------------------------------------------------------

describe('listingGridColumns', () =>
{
    it('widens the grid tier by tier, from two across on a phone to six on a wide desktop', () =>
    {
        expect(listingGridColumns(390)).toBe(2);
        expect(listingGridColumns(700)).toBe(3);
        expect(listingGridColumns(800)).toBe(4);
        expect(listingGridColumns(1100)).toBe(5);
        expect(listingGridColumns(1600)).toBe(6);
    });

    it('takes each tier from its own first pixel', () =>
    {
        expect(listingGridColumns(639)).toBe(2);
        expect(listingGridColumns(640)).toBe(3);
        expect(listingGridColumns(1279)).toBe(5);
        expect(listingGridColumns(1280)).toBe(6);
    });
});

//----------------------------------------------------------------------------------------------------------------------

// A row stacks its size and modified time under the name where there is no room for columns, and two lines of it need
// more height than one -- a scroller told the wrong height would overlap its own rows.
describe('listingRowHeight', () =>
{
    it('gives the narrow tier the taller, stacked row', () =>
    {
        expect(listingRowHeight(400)).toBe(LISTING_ROW_HEIGHT_STACKED);
    });

    it('gives every wider tier the single-line row', () =>
    {
        expect(listingRowHeight(640)).toBe(LISTING_ROW_HEIGHT);
        expect(listingRowHeight(1600)).toBe(LISTING_ROW_HEIGHT);
    });
});

//----------------------------------------------------------------------------------------------------------------------
