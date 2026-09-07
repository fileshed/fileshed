//----------------------------------------------------------------------------------------------------------------------
// Me Resource Access
//
// The typed client for the caller's own account: GET /api/me -- their profile and live quota usage, a 401 here being
// simply "no session" -- and the two self-service deletion calls, which answer the same refreshed profile so the
// schedule always arrives in the shape the session store already holds.
//----------------------------------------------------------------------------------------------------------------------

import { type MeResponse, meResponseCodec } from '@fileshed/core';

// Resource Access
import { requestJson } from './request.ts';

//----------------------------------------------------------------------------------------------------------------------

export async function fetchMe() : Promise<MeResponse>
{
    return requestJson('/api/me', { codec: meResponseCodec });
}

// Schedules the account for deletion after the instance's window. Every session ends with the request, this one
// included, so the answer is the last thing this browser learns before it has to sign in again.
export async function requestAccountDeletion() : Promise<MeResponse>
{
    return requestJson('/api/me/deletion', { method: 'POST', codec: meResponseCodec });
}

export async function cancelAccountDeletion() : Promise<MeResponse>
{
    return requestJson('/api/me/deletion', { method: 'DELETE', codec: meResponseCodec });
}

//----------------------------------------------------------------------------------------------------------------------
