//----------------------------------------------------------------------------------------------------------------------
// Listing Order
//
// The order itself is defined in core beside the name comparator, because the database orders the part of a listing
// this tier never holds and the two have to agree; this only applies it to an array.
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
