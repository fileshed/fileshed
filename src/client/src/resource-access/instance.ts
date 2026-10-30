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
import { requestJSON } from './request.ts';

//----------------------------------------------------------------------------------------------------------------------

export async function getInstance() : Promise<InstanceResponse>
{
    return requestJSON('/api/instance', { codec: instanceResponseCodec });
}

export async function completeSetup(request : SetupRequest) : Promise<SetupResponse>
{
    return requestJSON('/api/setup', { method: 'POST', body: request, codec: setupResponseCodec });
}

//----------------------------------------------------------------------------------------------------------------------
