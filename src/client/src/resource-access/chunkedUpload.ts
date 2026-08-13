//----------------------------------------------------------------------------------------------------------------------
// Chunked Upload
//
// A file's bytes delivered against one ticket as a sequence of PUTs, so no single request carries the whole file and a
// fronting proxy's request-body cap stops deciding how large a file the deployment accepts. Chunks go in order and one
// at a time -- the server appends each to the ticket's staging area and only the last one commits -- so a chunk that
// fails is retried on its own and the upload never restarts from zero within a session. Only failures worth another
// attempt are retried: the transport dropping, the server faulting, and a chunk overlapping its own torn attempt. A
// refusal of the bytes themselves is final, and a refusal of where they were placed is answered by cutting the rest of
// the file again from the position the server reports holding.
//----------------------------------------------------------------------------------------------------------------------

import {
    type NodeResponse,
    UPLOAD_CHUNK_IN_FLIGHT_MAX_ATTEMPTS,
    UPLOAD_CHUNK_IN_FLIGHT_RETRY_DELAY_MS,
    UPLOAD_CHUNK_MAX_ATTEMPTS,
    UPLOAD_CHUNK_RETRY_DELAY_MS,
    type UploadCommitMetadata,
} from '@fileshed/core';

// Resource Access
import { ApiError, ConflictApiError } from './apiError.ts';
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

    // The retry budgets, defaulted from the shared constants. Named here so a caller can drive the same code with a
    // different budget rather than the transport growing a second implementation.
    maxAttempts ?: number;
    retryDelayMs ?: number;
    inFlightMaxAttempts ?: number;
    inFlightRetryDelayMs ?: number;
}

//----------------------------------------------------------------------------------------------------------------------

function delay(ms : number) : Promise<void>
{
    return new Promise((resolve) => { setTimeout(resolve, ms); });
}

// Worth another attempt because nothing about these bytes was ever judged: the transport never reached the server
// (status 0), or the server broke while answering. A 409 is an answer, so it is never one of these.
function isTransportFailure(error : unknown) : boolean
{
    return error instanceof ApiError && (error.status === 0 || error.status >= 500);
}

// The ticket was busy with this chunk's own torn attempt, which is the one refusal that clears without the client
// changing anything. Every other conflict says these bytes do not belong where they were sent, which is as true the
// second time as the first.
function isChunkInFlight(error : unknown) : boolean
{
    return error instanceof ConflictApiError && error.code === 'upload.chunkInFlight';
}

// The position the server corrects a misplaced chunk to. Both disagreements carry one -- a chunk repeating ground the
// upload has already covered, and a chunk skipping past where it stands -- and either way the server's count is the
// one that decides where the rest of the file goes.
function correctedPosition(error : unknown) : number | null
{
    if(!(error instanceof ConflictApiError) || error.code !== 'upload.offsetConflict') { return null; }

    return error.receivedBytes;
}

// The chunks still owed with the upload standing at `position`: the whole file when it is starting, and the remainder
// when the server has corrected where it stands. The remainder is cut fresh rather than filtered out of the first
// plan, since a position the client did not choose need not fall on one of its boundaries.
function chunksFrom(position : number, totalBytes : number, chunkBytes : number) : UploadChunk[]
{
    if(position <= 0) { return planChunks(totalBytes, chunkBytes); }

    return planChunks(totalBytes - position, chunkBytes)
        .map((chunk) => ({ offset: position + chunk.offset, length: chunk.length }));
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
        inFlightMaxAttempts = UPLOAD_CHUNK_IN_FLIGHT_MAX_ATTEMPTS,
        inFlightRetryDelayMs = UPLOAD_CHUNK_IN_FLIGHT_RETRY_DELAY_MS,
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
        // Each failure spends only its own budget. The tear that leaves a chunk still being received is a transport
        // failure and already spent an attempt there; making the refusal it causes spend another would charge the
        // client twice for one event.
        let transportTries = 1;
        let inFlightTries = 1;

        for(;;)
        {
            try
            {
                // eslint-disable-next-line no-await-in-loop -- retries are sequential by definition
                return await send(chunk);
            }
            catch(error)
            {
                if(isChunkInFlight(error))
                {
                    if(inFlightTries >= inFlightMaxAttempts) { throw error; }

                    // eslint-disable-next-line no-await-in-loop -- back off before the next attempt
                    await delay(inFlightRetryDelayMs * inFlightTries);
                    inFlightTries += 1;
                }
                else if(isTransportFailure(error))
                {
                    if(transportTries >= maxAttempts) { throw error; }

                    // eslint-disable-next-line no-await-in-loop -- back off before the next attempt
                    await delay(retryDelayMs * transportTries);
                    transportTries += 1;
                }
                else { throw error; }
            }
        }
    };

    // The furthest position a chunk has been sent from. The server's count only ever moves forward -- a chunk is
    // accepted by advancing it -- so a correction to anywhere at or behind this is one the upload cannot act on.
    //
    // Every restart therefore lands on a whole byte strictly nearer the end than the last, of which there are
    // finitely many: that is the termination argument, and it is stated entirely in this function on purpose. Leave
    // out the floor and a position below zero replans the whole file and looks new each time, so the upload sends
    // byte zero forever; leave out whole-byte and a server answering 6.5, 6.75, 6.875 walks it most of the way there.
    let sentFrom = 0;

    let owed = chunksFrom(0, file.size, chunkBytes);
    let chunk = owed[0];

    while(chunk !== undefined)
    {
        sentFrom = Math.max(sentFrom, chunk.offset);

        try
        {
            // eslint-disable-next-line no-await-in-loop -- the server appends chunks in order; two at once is refused
            const outcome = await attempt(chunk);
            if(outcome.committed) { return outcome.node; }

            owed = owed.slice(1);
        }
        catch(error)
        {
            // The two sides disagree about where the upload stands, and the server's count settles it. Restarting is
            // only worth it strictly ahead of where this upload has already sent from and no further than the end of
            // the file; any other answer is one the upload cannot act on, and the conflict belongs to the caller.
            const position = correctedPosition(error);
            const usable = position !== null
                && Number.isInteger(position)
                && position > sentFrom
                && position <= file.size;

            if(!usable) { throw error; }

            owed = chunksFrom(position, file.size, chunkBytes);
        }

        chunk = owed[0];
    }

    throw new ApiError(0, 'The upload delivered every byte without committing the file.');
}

//----------------------------------------------------------------------------------------------------------------------
