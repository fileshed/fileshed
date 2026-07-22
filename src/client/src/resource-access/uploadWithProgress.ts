//----------------------------------------------------------------------------------------------------------------------
// Upload With Progress
//
// The one byte-moving request fetch can't make: a PUT that reports upload progress. fetch exposes no upload-progress
// event, so the upload manager's progress bar rides an XMLHttpRequest instead. Everything else mirrors the fetch
// wrappers -- credentialed, the commit target on the query string (a fresh node's name/parent/mime, or a replaced
// node's id alone), a codec-validated NodeResponse on success, and the same typed ApiError (regulation errors upgraded
// included) on any non-2xx, built from the shared body mapping rather than a second copy of it. An AbortSignal cancels
// a transfer in flight.
//----------------------------------------------------------------------------------------------------------------------

import { type NodeResponse, type UploadCommitMetadata, nodeResponseCodec } from '@fileshed/core';

// Resource Access
import { ApiError, apiErrorFromBody } from './apiError.ts';
import { commitQuery } from './blobs.ts';
import { buildUrl } from './request.ts';

//----------------------------------------------------------------------------------------------------------------------

export interface UploadProgress
{
    sentBytes : number;
    totalBytes : number;
}

export interface UploadWithProgressOptions
{
    ticket : string;
    body : Blob;
    commit : UploadCommitMetadata;
    onProgress ?: (progress : UploadProgress) => void;
    signal ?: AbortSignal;
}

//----------------------------------------------------------------------------------------------------------------------

// A 2xx body is the JSON node; an error body is the server's { error } shape. Anything that is not JSON (an empty 500,
// a proxy's HTML page) parses to null, which the error mapping renders as the bare status line.
function parseBody(text : string) : unknown
{
    if(text === '') { return null; }

    try { return JSON.parse(text); }
    catch { return null; }
}

//----------------------------------------------------------------------------------------------------------------------

export function uploadWithProgress(options : UploadWithProgressOptions) : Promise<NodeResponse>
{
    const { ticket, body, commit, onProgress, signal } = options;

    return new Promise<NodeResponse>((resolve, reject) =>
    {
        if(signal?.aborted) { reject(new DOMException('Upload cancelled', 'AbortError')); return; }

        const xhr = new XMLHttpRequest();
        xhr.open('PUT', buildUrl(`/api/uploads/${ ticket }`, commitQuery(commit)));
        xhr.withCredentials = true;
        xhr.responseType = 'text';
        xhr.setRequestHeader('accept', 'application/json');
        xhr.setRequestHeader('content-type', 'application/octet-stream');

        xhr.upload.addEventListener('progress', (event) =>
        {
            if(event.lengthComputable) { onProgress?.({ sentBytes: event.loaded, totalBytes: event.total }); }
        });

        xhr.addEventListener('load', () =>
        {
            const parsed = parseBody(xhr.responseText);

            if(xhr.status >= 200 && xhr.status < 300)
            {
                try { resolve(nodeResponseCodec.parse(parsed)); }
                catch(error) { reject(error); }

                return;
            }

            reject(apiErrorFromBody(xhr.status, xhr.statusText, parsed));
        });

        xhr.addEventListener('error', () => reject(new ApiError(0, 'The upload could not reach the server.')));
        xhr.addEventListener('abort', () => reject(new DOMException('Upload cancelled', 'AbortError')));

        signal?.addEventListener('abort', () => xhr.abort(), { once: true });

        xhr.send(body);
    });
}

//----------------------------------------------------------------------------------------------------------------------
