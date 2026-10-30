//----------------------------------------------------------------------------------------------------------------------
// File Byte Reads
//
// Both reads are incremental, so a multi-gigabyte file never lands in memory whole. The content SHA-256 streams through
// hash-wasm, never crypto.subtle.digest, which would buffer the entire file.
//----------------------------------------------------------------------------------------------------------------------

import { createSHA256 } from 'hash-wasm';

//----------------------------------------------------------------------------------------------------------------------

export interface HashProgress
{
    hashedBytes : number;
    totalBytes : number;
}

// The file's SHA-256 as lowercase hex, streamed a chunk at a time. onProgress reports bytes hashed so far so a caller
// can drive a progress bar; an already-aborted or mid-stream-aborted signal stops the read and throws.
export async function hashFile(
    file : File,
    onProgress ?: (progress : HashProgress) => void,
    signal ?: AbortSignal
) : Promise<string>
{
    const hasher = await createSHA256();
    hasher.init();

    const reader = file.stream().getReader();
    let hashedBytes = 0;

    try
    {
        for(;;)
        {
            if(signal?.aborted) { throw new DOMException('Hashing cancelled', 'AbortError'); }

            // eslint-disable-next-line no-await-in-loop -- a stream yields one chunk at a time; the reads are serial
            const { done, value } = await reader.read();
            if(done) { break; }

            hasher.update(value);
            hashedBytes += value.byteLength;
            onProgress?.({ hashedBytes, totalBytes: file.size });
        }
    }
    finally
    {
        reader.releaseLock();
    }

    return hasher.digest('hex');
}

// The bytes at each [ offset, length ] window of the file, in the order the challenge listed them -- the sampled reads
// a proof answer is HMAC'd over. The server caps windows to kilobytes, so materializing them is cheap.
export async function readSampleWindows(file : File, ranges : readonly [ number, number ][]) : Promise<ArrayBuffer[]>
{
    return Promise.all(ranges.map(([ offset, length ]) => file.slice(offset, offset + length).arrayBuffer()));
}

//----------------------------------------------------------------------------------------------------------------------
