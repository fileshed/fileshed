//----------------------------------------------------------------------------------------------------------------------
// Content Resource Access
//
// Reading a node's bytes for in-app consumers. A download navigation is a browser href (see downloads.ts), but the
// editor needs the bytes in hand (as text) and the avatar picker needs them as a Blob, so both are a credentialed fetch
// of the same inline download URL. The caller has already decided the file is small enough to hold in memory; this
// guards the transport only -- a non-2xx becomes the same typed ApiError every other resource-access module throws.
//----------------------------------------------------------------------------------------------------------------------

// Resource Access
import { apiErrorFromResponse } from './apiError.ts';
import { downloadUrl } from './downloads.ts';

//----------------------------------------------------------------------------------------------------------------------

export async function fetchNodeText(nodeID : string) : Promise<string>
{
    const response = await fetch(downloadUrl(nodeID, 'inline'), { credentials: 'include' });
    if(!response.ok) { throw await apiErrorFromResponse(response); }

    return response.text();
}

export async function fetchNodeBlob(nodeID : string) : Promise<Blob>
{
    const response = await fetch(downloadUrl(nodeID, 'inline'), { credentials: 'include' });
    if(!response.ok) { throw await apiErrorFromResponse(response); }

    return response.blob();
}

//----------------------------------------------------------------------------------------------------------------------
