//----------------------------------------------------------------------------------------------------------------------
// Access Request API DTOs
//
// Request/response contracts for share requests: a user who can see a stub but cannot resolve it asks the target's
// owner for access. The create body names only the desired ShareRole -- the node is the path parameter and 'owner' is
// unrepresentable. GET /api/access-requests answers both directions in one payload: requests incoming to the caller as
// an owner, each paired with the requester's summary (the requester announced themselves to the owner by asking, so
// disclosing them here discloses no one who didn't already disclose themselves), and the caller's own outgoing
// requests, plain. Dates are ISO strings.
//----------------------------------------------------------------------------------------------------------------------

// Models
import type { ShareRole } from '../role.ts';
import type { ShareRequestStatus } from '../shareRequest.ts';

// Requests
import type { UserSummary } from './nodes.ts';

//----------------------------------------------------------------------------------------------------------------------
// Create (POST /api/nodes/:id/access-requests)
//----------------------------------------------------------------------------------------------------------------------

export interface CreateAccessRequest
{
    requestedRole : ShareRole;
    message ?: string;
}

//----------------------------------------------------------------------------------------------------------------------
// Access request response -- the domain ShareRequest (models/shareRequest.ts) serialized. resolvedAt is null exactly
// when the request is still pending (the paired invariant), preserved here as a nullable ISO string.
//----------------------------------------------------------------------------------------------------------------------

export interface AccessRequestResponse
{
    id : string;
    nodeID : string;
    requesterID : string;
    requestedRole : ShareRole;
    message : string | null;
    status : ShareRequestStatus;
    createdAt : string;
    resolvedAt : string | null;
}

// One request incoming to the caller as an owner, paired with the requester's display summary.
export interface AccessRequestListEntry
{
    request : AccessRequestResponse;
    requester : UserSummary;
}

export interface AccessRequestListResponse
{
    incoming : AccessRequestListEntry[];
    outgoing : AccessRequestResponse[];
}

//----------------------------------------------------------------------------------------------------------------------
