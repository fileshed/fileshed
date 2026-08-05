//----------------------------------------------------------------------------------------------------------------------
// Upload Chunk Plan
//----------------------------------------------------------------------------------------------------------------------

// One request's worth of a file: where its bytes start and how many of them there are.
export interface UploadChunk
{
    offset : number;
    length : number;
}

//----------------------------------------------------------------------------------------------------------------------

// How a file is cut into requests: contiguous chunks covering every byte in order, the last one holding the remainder.
// An empty file is one empty chunk, not none -- the upload is completed by the request carrying its final byte, and a
// file with no bytes still needs a request to say so.
//
// The chunk size is always the caller's to supply, and it comes from the ticket the server just issued: a deployment
// can tune it, so a compiled default here would silently cut files to a size the instance never asked for.
export function planChunks(totalBytes : number, chunkBytes : number) : UploadChunk[]
{
    if(!Number.isInteger(chunkBytes) || chunkBytes < 1)
    {
        throw new Error('An upload chunk must be at least one byte.');
    }

    if(totalBytes <= 0) { return [ { offset: 0, length: 0 } ]; }

    const chunks : UploadChunk[] = [];
    for(let offset = 0; offset < totalBytes; offset += chunkBytes)
    {
        chunks.push({ offset, length: Math.min(chunkBytes, totalBytes - offset) });
    }

    return chunks;
}

//----------------------------------------------------------------------------------------------------------------------
