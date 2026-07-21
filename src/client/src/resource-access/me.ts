//----------------------------------------------------------------------------------------------------------------------
// Me Resource Access
//
// The typed client for GET /api/me -- the caller's own profile and live quota usage. A 401 here is simply "no session".
//----------------------------------------------------------------------------------------------------------------------

import { type MeResponse, meResponseCodec } from '@fileshed/core';

// Resource Access
import { requestJson } from './request.ts';

//----------------------------------------------------------------------------------------------------------------------

export async function fetchMe() : Promise<MeResponse>
{
    return requestJson('/api/me', { codec: meResponseCodec });
}

//----------------------------------------------------------------------------------------------------------------------
