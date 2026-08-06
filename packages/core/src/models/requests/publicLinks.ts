//----------------------------------------------------------------------------------------------------------------------
// Public Link API DTOs
//
// Request/response contracts for public-link management: mint a link on a file node, list a node's links, revoke one.
// Minting takes no body -- a link has nothing to configure. The direct-serving endpoint (/d/:token) streams bytes, not
// JSON, so it has no DTO here. The response carries the full token -- the owner needs it to share the link -- plus the
// ready-to-use `/d/:token` path so a client never rebuilds the URL shape by hand. Dates serialize as ISO strings, and
// revokedAt is null while the link is live (a revoked link still lists, so an owner can see it is dead).
//----------------------------------------------------------------------------------------------------------------------

export interface PublicLinkResponse
{
    id : string;
    nodeID : string;
    token : string;
    url : string;
    createdAt : string;
    revokedAt : string | null;
}

export interface PublicLinkListResponse
{
    links : PublicLinkResponse[];
}

//----------------------------------------------------------------------------------------------------------------------
