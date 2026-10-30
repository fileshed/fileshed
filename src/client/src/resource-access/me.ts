//----------------------------------------------------------------------------------------------------------------------
// Me Resource Access
//
// A 401 from GET /api/me means there is no session.
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
