//----------------------------------------------------------------------------------------------------------------------
// Search API DTOs
//
// Request contract for GET /api/search. v1 search is a name match scoped to the nodes the caller can access; the
// response is the ordinary paginated node envelope (NodeListResponse), so each hit carries the caller's effective role
// like every other node-returning endpoint. Wire shape only -- accessibility scoping is the manager's job.
//----------------------------------------------------------------------------------------------------------------------

export interface SearchQuery
{
    q : string;
    limit : number;
    offset : number;
}

//----------------------------------------------------------------------------------------------------------------------
