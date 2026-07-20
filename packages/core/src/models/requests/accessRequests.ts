//----------------------------------------------------------------------------------------------------------------------
// Access Request API DTOs
//
// Request/response contracts for share requests: a user who can see a stub but cannot resolve it asks the target's
// owner for access. The create body names only the desired ShareRole -- the node is the path parameter and 'owner' is
// unrepresentable. GET /api/access-requests answers both directions in one payload: requests incoming to the caller as
// an owner, and the caller's own outgoing requests. Dates are ISO strings.
//----------------------------------------------------------------------------------------------------------------------

// Models
import type { ShareRole } from '../role.ts';
import type { ShareRequestStatus } from '../shareRequest.ts';

//----------------------------------------------------------------------------------------------------------------------
// Create (POST /api/nodes/:id/access-requests)
//----------------------------------------------------------------------------------------------------------------------

export interface CreateAccessRequest
{
    requestedRole : ShareRole;
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
    status : ShareRequestStatus;
    createdAt : string;
    resolvedAt : string | null;
}

export interface AccessRequestListResponse
{
    incoming : AccessRequestResponse[];
    outgoing : AccessRequestResponse[];
}

//----------------------------------------------------------------------------------------------------------------------
