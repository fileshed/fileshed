//----------------------------------------------------------------------------------------------------------------------
// Preferences Resource Access
//
// The typed client for PATCH /api/me/preferences -- a partial patch of the caller's preferences blob. The server merges
// it key-wise and answers the refreshed profile, so the response is the whole MeResponse the session store holds.
//----------------------------------------------------------------------------------------------------------------------

import { type MeResponse, type UpdatePreferencesRequest, meResponseCodec } from '@fileshed/core';

// Resource Access
import { requestJson } from './request.ts';

//----------------------------------------------------------------------------------------------------------------------

export async function updatePreferences(patch : UpdatePreferencesRequest) : Promise<MeResponse>
{
    return requestJson('/api/me/preferences', { method: 'PATCH', body: patch, codec: meResponseCodec });
}

//----------------------------------------------------------------------------------------------------------------------
