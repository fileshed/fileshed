//----------------------------------------------------------------------------------------------------------------------
// Avatar Resource Access
//
// The typed client for the avatar routes. Upload POSTs the raw image bytes (the file's own type as Content-Type) and
// answers the refreshed MeResponse the session store adopts; remove is a bodiless DELETE, after which the store
// refetches the profile. No progress reporting -- an avatar is at most a couple of MiB, so a plain fetch body is fine.
//----------------------------------------------------------------------------------------------------------------------

import { type MeResponse, meResponseCodec } from '@fileshed/core';

// Resource Access
import { requestUpload, requestVoid } from './request.ts';

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

export async function deleteAvatar() : Promise<void>
{
    return requestVoid('/api/me/avatar', { method: 'DELETE' });
}

//----------------------------------------------------------------------------------------------------------------------
