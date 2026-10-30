//----------------------------------------------------------------------------------------------------------------------
// Public Link API DTOs
//
// The direct-serving endpoint (/d/:token) streams bytes rather than JSON, so it has no DTO here. A response carries the
// ready-to-use `/d/:token` path so a client never rebuilds the URL by hand, and a revoked link still lists so its owner
// can see it is dead.
//----------------------------------------------------------------------------------------------------------------------

export interface PublicLinkResponse
{
    id : string;
    nodeID : string;
    token : string;
    url : string;
    created : string;
    revokedAt : string | null;
}

export interface PublicLinkListResponse
{
    links : PublicLinkResponse[];
}

//----------------------------------------------------------------------------------------------------------------------
