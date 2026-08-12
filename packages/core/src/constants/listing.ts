//----------------------------------------------------------------------------------------------------------------------
// Listing Geometry
//
// The measurements a virtualized listing needs up front: every row and tile is a fixed size, so the scroller places
// items by arithmetic instead of measuring the DOM. Change a height here and the matching height class on the row or
// tile moves with it, or the listing overlaps itself.
//----------------------------------------------------------------------------------------------------------------------

// A list row, and the taller one the narrow tier renders: below `sm` a row stacks its size and modified time under the
// name, and two lines need the height.
export const LISTING_ROW_HEIGHT = 48;
export const LISTING_ROW_HEIGHT_STACKED = 56;
export const LISTING_STACK_WIDTH = 640;

// A grid tile, and the gutter between tiles in both directions. A Shared with me card runs taller than a drive or
// trash one: it carries the owner's attribution and the caller's role under the name.
export const LISTING_TILE_HEIGHT = 132;
export const LISTING_SHARED_TILE_HEIGHT = 164;
export const LISTING_GRID_GAP = 12;

// How many tiles a row of the grid holds: two at the narrowest, widening by the same tiers the grid laid out with
// before the tiles were virtualized. Widest first, so the first tier a viewport clears is the one it gets.
export const LISTING_GRID_BASE_COLUMNS = 2;
export const LISTING_GRID_TIERS = [
    { minWidth: 1280, columns: 6 },
    { minWidth: 1024, columns: 5 },
    { minWidth: 768, columns: 4 },
    { minWidth: 640, columns: 3 },
] as const;

//----------------------------------------------------------------------------------------------------------------------

export function listingGridColumns(viewportWidth : number) : number
{
    for(const tier of LISTING_GRID_TIERS)
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
