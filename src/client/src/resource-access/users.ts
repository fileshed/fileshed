//----------------------------------------------------------------------------------------------------------------------
// User Resource Access
//
// The typed client for GET /api/users/lookup -- resolve an exact email to a user summary for the share dialog's grant
// flow. A 404 (no account carries that email) surfaces as an ApiError the caller catches to show the inline "no user"
// hint, rather than a toast.
//----------------------------------------------------------------------------------------------------------------------

import { type UserSummary, userSummaryCodec } from '@fileshed/core';

// Resource Access
import { requestJson } from './request.ts';

//----------------------------------------------------------------------------------------------------------------------

export async function lookupUser(email : string) : Promise<UserSummary>
{
    return requestJson('/api/users/lookup', { query: { email }, codec: userSummaryCodec });
}

//----------------------------------------------------------------------------------------------------------------------
