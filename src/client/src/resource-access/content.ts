//----------------------------------------------------------------------------------------------------------------------
// Content Resource Access
//
// The caller has already decided the file is small enough to hold in memory; this only guards the transport.
//----------------------------------------------------------------------------------------------------------------------

// Resource Access
import { downloadUrl } from './downloads.ts';
import { apiFetch } from './request.ts';

//----------------------------------------------------------------------------------------------------------------------

export async function fetchNodeText(nodeID : string) : Promise<string>
{
    const response = await apiFetch(downloadUrl(nodeID, 'inline'));

    return response.text();
}

export async function fetchNodeBlob(nodeID : string) : Promise<Blob>
{
    const response = await apiFetch(downloadUrl(nodeID, 'inline'));

    return response.blob();
}

//----------------------------------------------------------------------------------------------------------------------
