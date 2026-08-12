//----------------------------------------------------------------------------------------------------------------------
// Listing Filters
//
// The Type, Owner, and Modified filters applied to a listing the client already holds whole, matching what the server
// selects when the same filters ride a query. Classification here is the filter's, not the presentation's: a link is a
// link whatever it points at, where a row borrows its target's icon.
//----------------------------------------------------------------------------------------------------------------------

import { type NodeResponse, type NodeTypeFamily, familyOfMimeType, isPlaylistFile } from '@fileshed/core';

//----------------------------------------------------------------------------------------------------------------------

export interface ListingFilters
{
    types : readonly NodeTypeFamily[];
    ownerID : string | null;

    // The half-open modified window: updated at or after `after`, and before `before`.
    after : string | null;
    before : string | null;
}

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
    if(filters.after !== null && node.updatedAt < filters.after) { return false; }

    return filters.before === null || node.updatedAt < filters.before;
}

export function filterNodes(nodes : readonly NodeResponse[], filters : ListingFilters) : NodeResponse[]
{
    return nodes.filter((node) => matches(node, filters));
}

//----------------------------------------------------------------------------------------------------------------------
