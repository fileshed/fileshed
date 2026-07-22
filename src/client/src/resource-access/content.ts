//----------------------------------------------------------------------------------------------------------------------
// Content Resource Access
//
// Reading a node's bytes as text for the in-app editor. A download navigation is a browser href (see downloads.ts), but
// the editor needs the bytes in hand, so this is a credentialed fetch of the same inline download URL, decoded as
// UTF-8. The caller has already decided the file is small enough to edit (the editor cap); this guards the transport
// only -- a non-2xx becomes the same typed ApiError every other resource-access module throws.
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

//----------------------------------------------------------------------------------------------------------------------
