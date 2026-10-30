//----------------------------------------------------------------------------------------------------------------------
// User Resource Access
//
// A 404 means no account has that email; the caller catches it to show an inline hint rather than a toast.
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
