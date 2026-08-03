//----------------------------------------------------------------------------------------------------------------------
// Search API DTOs
//
// Request and response contract for GET /api/search. v1 search is a name match scoped to the nodes the caller can
// access, answered with the paginated node envelope plus a location per hit.
//
// A location is the ancestor chain the CALLER may see, cut at the first ancestor they cannot resolve -- so a hit
// reached through a share names the share root and nothing of the owner's tree above it. `foreign` records where the
// surviving chain roots: false when it reaches a null parent the caller owns (their own files root), true when the
// walk was cut short or topped out in someone else's tree. That is the same predicate the drive applies to its own
// breadcrumb, so a location and a breadcrumb can never disagree about where a node lives.
//----------------------------------------------------------------------------------------------------------------------

// Requests
import type { NodeListResponse } from './nodes.ts';

//----------------------------------------------------------------------------------------------------------------------

export interface SearchQuery
{
    q : string;
    limit : number;
    offset : number;
}

export interface LocationCrumb
{
    id : string;
    name : string;
}

export interface NodeLocation
{
    // Highest visible ancestor first, ending at the direct parent. Empty when the node sits at a tree root, or when
    // its parent is out of the caller's reach -- `foreign` is what tells those two apart.
    crumbs : LocationCrumb[];
    foreign : boolean;
}

export interface SearchResponse extends NodeListResponse
{
    // One entry per node in `nodes`, keyed by node id.
    locations : Record<string, NodeLocation>;
}

//----------------------------------------------------------------------------------------------------------------------
