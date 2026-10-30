//----------------------------------------------------------------------------------------------------------------------
// Access Request API DTOs
//
// Incoming requests carry the requester's summary. The requester announced themselves to the owner by asking, so
// disclosing them here discloses no one who did not already disclose themselves.
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
    created : string;
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
