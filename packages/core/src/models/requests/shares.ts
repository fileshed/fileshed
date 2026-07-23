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

// Requests
import type { NodeTypeFamily, UserSummary } from './nodes.ts';

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

//----------------------------------------------------------------------------------------------------------------------
// Grants list (GET /api/nodes/:id/shares) -- each grant paired with its grantee's UserSummary, in one round trip,
// so the share dialog can render a name and avatar without a lookup per row. Owner-only, so every grantee it
// discloses is already someone the caller granted access to themselves.
//----------------------------------------------------------------------------------------------------------------------

export interface ShareListEntry
{
    share : ShareResponse;
    grantee : UserSummary;
}

export interface ShareListResponse
{
    shares : ShareListEntry[];
}

//----------------------------------------------------------------------------------------------------------------------
// Shared with me (GET /api/shared-with-me) -- the caller's active shares, each with enough of the target to render it
// and whether the caller has already placed a link to it (placement is independent of the grant). The target's owner
// rides alongside as a full summary, so the client renders "Shared by <name>" without a lookup per row -- the owner
// shared WITH the caller by granting, so disclosing them here discloses no one who didn't already disclose themselves.
// No target ACL rides here; every resolution re-runs the check as the viewer.
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
    owner : UserSummary;
    placed : boolean;
}

export interface SharedWithMeResponse
{
    entries : SharedWithMeEntry[];
}

//----------------------------------------------------------------------------------------------------------------------
// Shared with me filters (GET /api/shared-with-me query) -- the same Type and Modified filters the drive listing takes,
// applied here to the shared TARGET's node type and last-modified time. `types` is always present (empty = unfiltered);
// the date window is half-open (updatedAfter inclusive, updatedBefore exclusive). The listing is unpaginated, so no
// pagination or sort rides here, and there is no owner facet -- a shared listing spans many owners by nature.
//----------------------------------------------------------------------------------------------------------------------

export interface SharedWithMeQuery
{
    types : NodeTypeFamily[];
    updatedAfter ?: string;
    updatedBefore ?: string;
}

//----------------------------------------------------------------------------------------------------------------------
