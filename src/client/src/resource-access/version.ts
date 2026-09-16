//----------------------------------------------------------------------------------------------------------------------
// Version Resource Access
//----------------------------------------------------------------------------------------------------------------------

import { type VersionResponse, versionResponseCodec } from '@fileshed/core';

// Resource Access
import { requestJson } from './request.ts';

//----------------------------------------------------------------------------------------------------------------------

export async function fetchVersion() : Promise<VersionResponse>
{
    return requestJson('/api/version', { codec: versionResponseCodec });
}

//----------------------------------------------------------------------------------------------------------------------
