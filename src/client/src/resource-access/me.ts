//----------------------------------------------------------------------------------------------------------------------
// Me Resource Access
//
// The typed client for GET /api/me -- the caller's own profile and live quota usage. First of the fetch wrappers every
// later resource-access module mirrors: a credentialed fetch, JSON, the shared codec validating the wire at the
// boundary, and an ApiError on any non-2xx (a 401 here is simply "no session").
//----------------------------------------------------------------------------------------------------------------------

import { type MeResponse, meResponseCodec } from '@fileshed/core';

// Resource Access
import { ApiError } from './apiError.ts';

//----------------------------------------------------------------------------------------------------------------------

export async function fetchMe() : Promise<MeResponse>
{
    const response = await fetch('/api/me', {
        credentials: 'include',
        headers: { accept: 'application/json' },
    });

    if(!response.ok)
    {
        throw await ApiError.fromResponse(response);
    }

    return meResponseCodec.parse(await response.json());
}

//----------------------------------------------------------------------------------------------------------------------
