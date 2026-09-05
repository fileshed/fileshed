//----------------------------------------------------------------------------------------------------------------------
// Listing Order
//
// The display order of a listing the client holds whole. What that order IS lives in core beside the name comparator,
// because the database orders the listings this tier never sees and a reader scrolling past that line reads both; this
// only applies it to an array.
//----------------------------------------------------------------------------------------------------------------------

import { type NodeResponse, type NodeSortKey, type SortDirection, compareListingNodes } from '@fileshed/core';

//----------------------------------------------------------------------------------------------------------------------

export function sortNodes(
    nodes : readonly NodeResponse[],
    key : NodeSortKey,
    direction : SortDirection
) : NodeResponse[]
{
    return [ ...nodes ].sort((left, right) => compareListingNodes(key, direction, left, right));
}

//----------------------------------------------------------------------------------------------------------------------
