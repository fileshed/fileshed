//----------------------------------------------------------------------------------------------------------------------
// Public Link API DTOs
//
// Request/response contracts for public-link management: mint a link on a file node, list a node's links, revoke one.
// The direct-serving endpoint (/d/:token) streams bytes, not JSON, so it has no DTO here. Dates serialize as ISO
// strings. The response carries the full token -- the owner needs it to share the link -- plus the ready-to-use
// `/d/:token` path so a client never rebuilds the URL shape by hand.
//----------------------------------------------------------------------------------------------------------------------

// Models
import type { PublicLinkDisposition, PublicLinkMode } from '../publicLink.ts';

//----------------------------------------------------------------------------------------------------------------------
// Create (POST /api/nodes/:id/links) -- mode and disposition are the two per-link toggles. disposition drives
// Content-Disposition on the served response (inline hotlink vs forced download).
//----------------------------------------------------------------------------------------------------------------------

export interface CreatePublicLinkRequest
{
    mode : PublicLinkMode;
    disposition : PublicLinkDisposition;
}

//----------------------------------------------------------------------------------------------------------------------
// Responses -- the public_link row plus the resolved `/d/:token` path. revokedAt is null while the link is live, an ISO
// string once revoked (a revoked link still lists, so an owner can see it is dead).
//----------------------------------------------------------------------------------------------------------------------

export interface PublicLinkResponse
{
    id : string;
    nodeID : string;
    token : string;
    mode : PublicLinkMode;
    disposition : PublicLinkDisposition;
    url : string;
    createdAt : string;
    revokedAt : string | null;
}

export interface PublicLinkListResponse
{
    links : PublicLinkResponse[];
}

//----------------------------------------------------------------------------------------------------------------------
