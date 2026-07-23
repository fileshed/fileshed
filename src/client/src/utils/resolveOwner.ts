//----------------------------------------------------------------------------------------------------------------------
// Owner Resolution
//
// Looks a node's owner up in a listing's owners facet (the whole folder's distinct owners, not just the visible
// page). A miss returns null rather than throwing, so a row whose owner fell out of the facet still renders --
// callers fall back to a bare avatar keyed off the raw id.
//----------------------------------------------------------------------------------------------------------------------

import type { NodeResponse, UserSummary } from '@fileshed/core';

//----------------------------------------------------------------------------------------------------------------------

export function resolveOwner(ownerID : string, owners : readonly UserSummary[]) : UserSummary | null
{
    return owners.find((owner) => owner.id === ownerID) ?? null;
}

// The id the Owner column attributes a node to: for a link, the RESOLVED TARGET's owner -- a link placed via "Add to
// my files" points at someone else's file, so the column names that someone, not the recipient who placed the link.
// A dead link (no resolvable target) has nothing to show but its own owner, so it falls back to that.
export function ownerIDFor(node : NodeResponse) : string
{
    if(node.type === 'link' && node.target !== null) { return node.target.ownerID; }

    return node.ownerID;
}

//----------------------------------------------------------------------------------------------------------------------
