//----------------------------------------------------------------------------------------------------------------------
// Upload Chunk Plan
//
// The plan decides how a file is cut into requests, so every expectation here is arithmetic derived by hand from the
// file size and the chunk size -- never read back from the planner. The contract: contiguous chunks in order, covering
// every byte exactly once, none larger than the chunk size.
//----------------------------------------------------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';

// Engines (under test)
import { type UploadChunk, planChunks } from '@client/engines/uploads/chunks.ts';

//----------------------------------------------------------------------------------------------------------------------

// The properties every plan owes its file, whatever the sizes: the chunks start at the beginning, each picks up where
// the last left off, and together they carry the whole file and nothing more.
function coversExactly(chunks : UploadChunk[], totalBytes : number) : boolean
{
    let expectedOffset = 0;
    for(const chunk of chunks)
    {
        if(chunk.offset !== expectedOffset) { return false; }
        expectedOffset += chunk.length;
    }

    return expectedOffset === totalBytes;
}

//----------------------------------------------------------------------------------------------------------------------

describe('planChunks', () =>
{
    it('sends a file smaller than one chunk as a single whole-file request', () =>
    {
        expect(planChunks(1000, 8192)).toEqual([ { offset: 0, length: 1000 } ]);
    });

    it('sends a file of exactly one chunk as a single request', () =>
    {
        expect(planChunks(8192, 8192)).toEqual([ { offset: 0, length: 8192 } ]);
    });

    it('cuts a file into whole chunks plus a shorter final one', () =>
    {
        expect(planChunks(20_000, 8192)).toEqual([
            { offset: 0, length: 8192 },
            { offset: 8192, length: 8192 },
            { offset: 16_384, length: 3616 },
        ]);
    });

    it('leaves no gap or overlap for a size that divides evenly', () =>
    {
        const chunks = planChunks(24_576, 8192);

        expect(chunks).toHaveLength(3);
        expect(coversExactly(chunks, 24_576)).toBe(true);
    });

    it('carries an empty file as one empty request, since some request must complete the upload', () =>
    {
        expect(planChunks(0, 8192)).toEqual([ { offset: 0, length: 0 } ]);
    });

    // The size is whatever the instance said, so no chunk may exceed it -- that number is the request-body cap the
    // deployment's proxy was chosen to satisfy.
    it('keeps every chunk within the size it was given', () =>
    {
        const chunkBytes = 8 * 1024 * 1024;
        const totalBytes = (chunkBytes * 3) + 17;

        const chunks = planChunks(totalBytes, chunkBytes);

        expect(chunks).toHaveLength(4);
        expect(chunks.every((chunk) => chunk.length <= chunkBytes)).toBe(true);
        expect(coversExactly(chunks, totalBytes)).toBe(true);
    });

    // The deployment's chunk size decides the plan, so the same file cut at a different size is a different sequence
    // of requests -- an instance that tuned the value gets uploads shaped the way it asked for.
    it('cuts the same file differently for a deployment that tuned the size', () =>
    {
        const totalBytes = 20 * 1024 * 1024;

        expect(planChunks(totalBytes, 8 * 1024 * 1024)).toEqual([
            { offset: 0, length: 8 * 1024 * 1024 },
            { offset: 8 * 1024 * 1024, length: 8 * 1024 * 1024 },
            { offset: 16 * 1024 * 1024, length: 4 * 1024 * 1024 },
        ]);

        expect(planChunks(totalBytes, 16 * 1024 * 1024)).toEqual([
            { offset: 0, length: 16 * 1024 * 1024 },
            { offset: 16 * 1024 * 1024, length: 4 * 1024 * 1024 },
        ]);
    });

    it('refuses a chunk size that could never finish the file', () =>
    {
        expect(() => planChunks(1000, 0)).toThrow();
    });
});

//----------------------------------------------------------------------------------------------------------------------
