//----------------------------------------------------------------------------------------------------------------------
// Listing Order
//
// The display order of a listing the client holds whole. This is a separate concern from the order the listing arrived
// in: the server's ordering only has to be stable enough that chunked fetching never skips or repeats a row, while
// what the user reads down the screen is this comparator's business. The two are free to differ.
//----------------------------------------------------------------------------------------------------------------------

import { type NodeResponse, type NodeSortKey, type SortDirection, compareNames } from '@fileshed/core';

//----------------------------------------------------------------------------------------------------------------------

function compareText(left : string, right : string) : number
{
    if(left < right) { return -1; }

    return left > right ? 1 : 0;
}

// Folders lead every ordering, whichever key sorts the rest and whichever direction it runs.
function placeRank(node : NodeResponse) : number
{
    return node.type === 'folder' ? 0 : 1;
}

// A folder is not measured and a link is a pointer: neither carries bytes, so both weigh nothing beside a file.
function sizeOf(node : NodeResponse) : number
{
    return node.type === 'file' ? node.size : 0;
}

function mimeOf(node : NodeResponse) : string
{
    return node.type === 'file' ? node.mimeType : '';
}

// Timestamps cross the wire as fixed-width UTC instants, so ordering them as text orders them as time -- and spares a
// date parse per comparison, of which a big folder runs a hundred thousand.
function compareKey(key : NodeSortKey, left : NodeResponse, right : NodeResponse) : number
{
    switch (key)
    {
        case 'name': return compareNames(left.name, right.name);
        case 'size': return sizeOf(left) - sizeOf(right);
        case 'createdAt': return compareText(left.createdAt, right.createdAt);
        case 'updatedAt': return compareText(left.updatedAt, right.updatedAt);
        case 'kind': return compareText(left.type, right.type) || compareNames(mimeOf(left), mimeOf(right));
    }
}

//----------------------------------------------------------------------------------------------------------------------

export function sortNodes(
    nodes : readonly NodeResponse[],
    key : NodeSortKey,
    direction : SortDirection
) : NodeResponse[]
{
    const sign = direction === 'asc' ? 1 : -1;

    return [ ...nodes ].sort((left, right) =>
    {
        const places = placeRank(left) - placeRank(right);
        if(places !== 0) { return places; }

        const keyed = compareKey(key, left, right) * sign;
        if(keyed !== 0) { return keyed; }

        // Rows the key cannot separate still need one fixed order, or re-sorting would shuffle equals under the user.
        return compareNames(left.name, right.name) || compareText(left.id, right.id);
    });
}

//----------------------------------------------------------------------------------------------------------------------
