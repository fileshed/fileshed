//----------------------------------------------------------------------------------------------------------------------
// Listing Filters
//
// These must select what the server selects for the same filters on a query. A link counts as a link whatever it points
// at, even though its row borrows the target's icon.
//----------------------------------------------------------------------------------------------------------------------

import {
    type ChildrenQuery,
    type NodeResponse,
    type NodeTypeFamily,
    familyOfMimeType,
    isPlaylistFile,
} from '@fileshed/core';

//----------------------------------------------------------------------------------------------------------------------

export interface ListingFilters
{
    types : readonly NodeTypeFamily[];
    ownerID : string | null;

    // The half-open modified window: updated at or after `after`, and before `before`.
    after : string | null;
    before : string | null;
}

// The query fields the filters travel in. A trash or shared-with-me listing takes all of them but ownerID.
export type ListingFilterQuery = Partial<Pick<ChildrenQuery, 'types' | 'ownerID' | 'updatedAfter' | 'updatedBefore'>>;

//----------------------------------------------------------------------------------------------------------------------

// The one family a node belongs to, or null for a file whose mime maps to none. Playlists are carved out of the audio
// family by name as well as mime, since m3u files arrive under whatever type the uploader felt like sending.
export function familyOf(node : NodeResponse) : NodeTypeFamily | null
{
    if(node.type === 'folder') { return 'folders'; }
    if(node.type === 'link') { return 'links'; }

    return isPlaylistFile(node.mimeType, node.name) ? 'playlists' : familyOfMimeType(node.mimeType);
}

function matches(node : NodeResponse, filters : ListingFilters) : boolean
{
    if(filters.types.length > 0)
    {
        const family = familyOf(node);
        if(family === null || !filters.types.includes(family)) { return false; }
    }

    if(filters.ownerID !== null && node.ownerID !== filters.ownerID) { return false; }
    if(filters.after !== null && node.updated < filters.after) { return false; }

    return filters.before === null || node.updated < filters.before;
}

export function filterNodes(nodes : readonly NodeResponse[], filters : ListingFilters) : NodeResponse[]
{
    return nodes.filter((node) => matches(node, filters));
}

// An empty type selection, no owner and an open bound drop out of the query, so the server reads them as unfiltered.
export function filterQuery(filters : ListingFilters) : ListingFilterQuery
{
    const query : ListingFilterQuery = {};

    if(filters.types.length > 0) { query.types = [ ...filters.types ]; }
    if(filters.ownerID !== null) { query.ownerID = filters.ownerID; }
    if(filters.after !== null) { query.updatedAfter = filters.after; }
    if(filters.before !== null) { query.updatedBefore = filters.before; }

    return query;
}

//----------------------------------------------------------------------------------------------------------------------
