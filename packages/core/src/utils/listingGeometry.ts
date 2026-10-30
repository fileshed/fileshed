//----------------------------------------------------------------------------------------------------------------------
// Listing Geometry
//----------------------------------------------------------------------------------------------------------------------

// Constants
import {
    LISTING_GRID_BASE_COLUMNS,
    LISTING_ROW_HEIGHT,
    LISTING_ROW_HEIGHT_STACKED,
    LISTING_STACK_WIDTH,
    listingGridTiers,
} from '../constants/listing.ts';

//----------------------------------------------------------------------------------------------------------------------

// How many tiles a row of the grid holds at this width.
export function listingGridColumns(viewportWidth : number) : number
{
    for(const tier of listingGridTiers)
    {
        if(viewportWidth >= tier.minWidth) { return tier.columns; }
    }

    return LISTING_GRID_BASE_COLUMNS;
}

export function listingRowHeight(viewportWidth : number) : number
{
    return viewportWidth < LISTING_STACK_WIDTH ? LISTING_ROW_HEIGHT_STACKED : LISTING_ROW_HEIGHT;
}

//----------------------------------------------------------------------------------------------------------------------
