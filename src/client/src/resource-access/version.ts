//----------------------------------------------------------------------------------------------------------------------
// Version Resource Access
//----------------------------------------------------------------------------------------------------------------------

import { type VersionResponse, versionResponseCodec } from '@fileshed/core';

// Resource Access
import { requestJSON } from './request.ts';

//----------------------------------------------------------------------------------------------------------------------

export async function getVersion() : Promise<VersionResponse>
{
    return requestJSON('/api/version', { codec: versionResponseCodec });
}

//----------------------------------------------------------------------------------------------------------------------
