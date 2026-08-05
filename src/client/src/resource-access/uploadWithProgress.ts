//----------------------------------------------------------------------------------------------------------------------
// Upload With Progress
//
// The one byte-moving request fetch can't make: a PUT that reports upload progress. fetch exposes no upload-progress
// event, so the upload manager's progress bar rides an XMLHttpRequest instead. Everything else mirrors the fetch
// wrappers -- credentialed, the commit target on the query string (a fresh node's name/parent/mime, or a replaced
// node's id alone), a codec-validated body on success, and the same typed ApiError (regulation errors upgraded
// included) on any non-2xx, built from the shared body mapping rather than a second copy of it. An AbortSignal cancels
// a transfer in flight.
//
// The body is one chunk of a file, or all of it. A chunk that leaves the file incomplete comes back 202 with the
// upload's position; the chunk that completes it comes back with the committed node.
//----------------------------------------------------------------------------------------------------------------------

import {
    type NodeResponse,
    type UploadCommitMetadata,
    nodeResponseCodec,
    uploadChunkAcceptedCodec,
} from '@fileshed/core';

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

    // Where this body's bytes belong in the file. Omitted for a whole-file upload.
    offset ?: number;

    onProgress ?: (progress : UploadProgress) => void;
    signal ?: AbortSignal;
}

// What the server did with the bytes: committed the file node, or took them and is waiting for the rest.
export type UploadOutcome
    = | { committed : true; node : NodeResponse }
    | { committed : false; receivedBytes : number; totalBytes : number };

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

export function uploadWithProgress(options : UploadWithProgressOptions) : Promise<UploadOutcome>
{
    const { ticket, body, commit, offset, onProgress, signal } = options;

    return new Promise<UploadOutcome>((resolve, reject) =>
    {
        if(signal?.aborted) { reject(new DOMException('Upload cancelled', 'AbortError')); return; }

        const xhr = new XMLHttpRequest();
        xhr.open('PUT', buildUrl(`/api/uploads/${ ticket }`, { ...commitQuery(commit), offset }));
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

            if(xhr.status === 202)
            {
                try { resolve({ committed: false, ...uploadChunkAcceptedCodec.parse(parsed) }); }
                catch(error) { reject(error); }

                return;
            }

            if(xhr.status >= 200 && xhr.status < 300)
            {
                try { resolve({ committed: true, node: nodeResponseCodec.parse(parsed) }); }
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
