//----------------------------------------------------------------------------------------------------------------------
// Chunked Upload
//
// A file's bytes delivered against one ticket as a sequence of PUTs, so no single request carries the whole file and a
// fronting proxy's request-body cap stops deciding how large a file the deployment accepts. Chunks go in order and one
// at a time -- the server appends each to the ticket's staging area and only the last one commits -- so a chunk that
// fails is retried on its own and the upload never restarts from zero within a session. Only failures worth another
// attempt are retried: the transport dropping and the server faulting. A refusal the server meant is final.
//----------------------------------------------------------------------------------------------------------------------

import {
    type NodeResponse,
    UPLOAD_CHUNK_MAX_ATTEMPTS,
    UPLOAD_CHUNK_RETRY_DELAY_MS,
    type UploadCommitMetadata,
} from '@fileshed/core';

// Resource Access
import { ApiError } from './apiError.ts';
import { type UploadOutcome, type UploadProgress, uploadWithProgress } from './uploadWithProgress.ts';

// Engines
import { type UploadChunk, planChunks } from '../engines/uploads/chunks.ts';

//----------------------------------------------------------------------------------------------------------------------

export interface ChunkedUploadOptions
{
    ticket : string;
    file : Blob;
    commit : UploadCommitMetadata;
    onProgress ?: (progress : UploadProgress) => void;
    signal ?: AbortSignal;

    // The size to cut the file into, as the claim that issued this ticket reported it. Required: the instance decides
    // it, and cutting to any other number is the client guessing at a deployment it was already told about.
    chunkBytes : number;

    // The retry budget, defaulted from the shared constants. Named here so a caller can drive the same code with a
    // different budget rather than the transport growing a second implementation.
    maxAttempts ?: number;
    retryDelayMs ?: number;
}

//----------------------------------------------------------------------------------------------------------------------

function delay(ms : number) : Promise<void>
{
    return new Promise((resolve) => { setTimeout(resolve, ms); });
}

// Worth another attempt when nothing about the request itself was refused: the transport never reached the server
// (status 0), or the server broke while answering. Everything else -- a rejected placement, an offset the server
// disagrees with, a quota refusal -- says the same thing however many times it is asked.
function isRetryable(error : unknown) : boolean
{
    return error instanceof ApiError && (error.status === 0 || error.status >= 500);
}

//----------------------------------------------------------------------------------------------------------------------

export async function uploadChunked(options : ChunkedUploadOptions) : Promise<NodeResponse>
{
    const {
        ticket,
        file,
        commit,
        onProgress,
        signal,
        chunkBytes,
        maxAttempts = UPLOAD_CHUNK_MAX_ATTEMPTS,
        retryDelayMs = UPLOAD_CHUNK_RETRY_DELAY_MS,
    } = options;

    // Chunks are contiguous from the start of the file, so the bytes already delivered are exactly the current chunk's
    // offset -- progress needs no separate tally, and a retried chunk honestly reports its ground again.
    const send = (chunk : UploadChunk) : Promise<UploadOutcome> => uploadWithProgress({
        ticket,
        body: file.slice(chunk.offset, chunk.offset + chunk.length),
        commit,
        offset: chunk.offset,
        onProgress: (progress) => onProgress?.({
            sentBytes: chunk.offset + progress.sentBytes,
            totalBytes: file.size,
        }),
        signal,
    });

    const attempt = async (chunk : UploadChunk) : Promise<UploadOutcome> =>
    {
        for(let tries = 1; ; tries += 1)
        {
            try
            {
                // eslint-disable-next-line no-await-in-loop -- retries are sequential by definition
                return await send(chunk);
            }
            catch(error)
            {
                if(tries >= maxAttempts || !isRetryable(error)) { throw error; }

                // eslint-disable-next-line no-await-in-loop -- back off before the next attempt
                await delay(retryDelayMs * tries);
            }
        }
    };

    for(const chunk of planChunks(file.size, chunkBytes))
    {
        // eslint-disable-next-line no-await-in-loop -- the server appends chunks in order; two at once is refused
        const outcome = await attempt(chunk);

        if(outcome.committed) { return outcome.node; }
    }

    throw new ApiError(0, 'The upload delivered every byte without committing the file.');
}

//----------------------------------------------------------------------------------------------------------------------
