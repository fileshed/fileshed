//----------------------------------------------------------------------------------------------------------------------
// Avatar Resource Access
//
// No upload progress: an avatar is at most a couple of MiB, so a plain fetch body is enough.
//----------------------------------------------------------------------------------------------------------------------

import { type MeResponse, meResponseCodec } from '@fileshed/core';

// Resource Access
import { requestJson, requestUpload } from './request.ts';

//----------------------------------------------------------------------------------------------------------------------

export async function uploadAvatar(file : File) : Promise<MeResponse>
{
    return requestUpload('/api/me/avatar', {
        method: 'POST',
        body: file,
        contentType: file.type,
        codec: meResponseCodec,
    });
}

export async function deleteAvatar() : Promise<MeResponse>
{
    return requestJson('/api/me/avatar', { method: 'DELETE', codec: meResponseCodec });
}

//----------------------------------------------------------------------------------------------------------------------
