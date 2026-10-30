//----------------------------------------------------------------------------------------------------------------------
// Content Resource Access
//
// The caller has already decided the file is small enough to hold in memory; this only guards the transport.
//----------------------------------------------------------------------------------------------------------------------

// Resource Access
import { downloadURL } from './downloads.ts';
import { apiFetch } from './request.ts';

//----------------------------------------------------------------------------------------------------------------------

export async function getNodeText(nodeID : string) : Promise<string>
{
    const response = await apiFetch(downloadURL(nodeID, 'inline'));

    return response.text();
}

export async function getNodeBlob(nodeID : string) : Promise<Blob>
{
    const response = await apiFetch(downloadURL(nodeID, 'inline'));

    return response.blob();
}

//----------------------------------------------------------------------------------------------------------------------
