//----------------------------------------------------------------------------------------------------------------------
// Admin API DTOs
//
// The admin-only surface for managing other users. Setting a quota carries a single field: the byte cap, or null for
// unlimited. The successful response is the updated user's UserProfile -- the same row shape the admin listing returns.
//----------------------------------------------------------------------------------------------------------------------

//----------------------------------------------------------------------------------------------------------------------
// Set quota (PATCH /api/admin/users/:id)
//----------------------------------------------------------------------------------------------------------------------

export interface SetQuotaRequest
{
    quotaLimit : number | null;
}

//----------------------------------------------------------------------------------------------------------------------
