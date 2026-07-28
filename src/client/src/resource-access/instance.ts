//----------------------------------------------------------------------------------------------------------------------
// Instance Resource Access
//
// The anonymous pre-auth handshake and the first-run setup action. Both exist before any session can: the sign-in
// and setup pages decide which of them the visitor should see from fetchInstance's answer.
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
