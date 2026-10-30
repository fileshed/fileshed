//----------------------------------------------------------------------------------------------------------------------
// Instance Resource Access
//----------------------------------------------------------------------------------------------------------------------

import {
    type InstanceResponse,
    type SetupRequest,
    type SetupResponse,
    instanceResponseCodec,
    setupResponseCodec,
} from '@fileshed/core';

// Resource Access
import { requestJson } from './request.ts';

//----------------------------------------------------------------------------------------------------------------------

export async function fetchInstance() : Promise<InstanceResponse>
{
    return requestJson('/api/instance', { codec: instanceResponseCodec });
}

export async function completeSetup(request : SetupRequest) : Promise<SetupResponse>
{
    return requestJson('/api/setup', { method: 'POST', body: request, codec: setupResponseCodec });
}

//----------------------------------------------------------------------------------------------------------------------
