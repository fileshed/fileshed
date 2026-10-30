//----------------------------------------------------------------------------------------------------------------------
// Preferences Resource Access
//
// The server merges the patch key by key and answers the refreshed profile.
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
