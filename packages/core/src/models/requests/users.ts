//----------------------------------------------------------------------------------------------------------------------
// User Lookup API DTO
//
// Request contract for GET /api/users/lookup: resolve an EXACT email address to a UserSummary so a sharer can confirm
// who they are about to grant before granting. Exact match only -- no prefix or substring search -- so the endpoint
// cannot enumerate accounts. The response reuses UserSummary (models/requests/nodes.ts); there is no bespoke response
// shape here.
//----------------------------------------------------------------------------------------------------------------------

export interface UserLookupQuery
{
    email : string;
}

//----------------------------------------------------------------------------------------------------------------------
