//----------------------------------------------------------------------------------------------------------------------
// Share API DTOs
//
// Request/response contracts for the sharing endpoints. A grant names a grantee and a ShareRole
// -- 'owner' is unrepresentable here, since owner authority is ownership, never a share row. Shared-with-me
// carries a target summary and a placement flag: whether the caller has placed a link to the shared item.
// Dates serialize as ISO strings.
//----------------------------------------------------------------------------------------------------------------------

// Models
import type { NodeType } from '../node.ts';
import type { ShareRole } from '../role.ts';

//----------------------------------------------------------------------------------------------------------------------
// Grant (POST /api/nodes/:id/shares) -- the node is the path parameter, so the body is just grantee + role.
//----------------------------------------------------------------------------------------------------------------------

export interface GrantShareRequest
{
    granteeUserID : string;
    role : ShareRole;
}

//----------------------------------------------------------------------------------------------------------------------
// Share response -- the domain Share (models/share.ts) with its createdAt serialized.
//----------------------------------------------------------------------------------------------------------------------

export interface ShareResponse
{
    id : string;
    nodeID : string;
    granteeUserID : string;
    role : ShareRole;
    createdBy : string;
    createdAt : string;
}

export interface ShareListResponse
{
    shares : ShareResponse[];
}

//----------------------------------------------------------------------------------------------------------------------
// Shared with me (GET /api/shared-with-me) -- the caller's active shares, each with enough of the target to render it
// (its owner is the sharer) and whether the caller has already placed a link to it (placement is independent
// of the grant). No target ACL rides here; every resolution re-runs the check as the viewer.
//----------------------------------------------------------------------------------------------------------------------

export interface SharedTarget
{
    id : string;
    type : NodeType;
    name : string;
    ownerID : string;
    mimeType ?: string;
    size ?: number;
}

export interface SharedWithMeEntry
{
    share : ShareResponse;
    target : SharedTarget;
    placed : boolean;
}

export interface SharedWithMeResponse
{
    entries : SharedWithMeEntry[];
}

//----------------------------------------------------------------------------------------------------------------------
