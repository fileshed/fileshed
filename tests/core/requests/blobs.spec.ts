//----------------------------------------------------------------------------------------------------------------------
// Blob DTOs -- the claim response discriminated union and its range-count invariant
//----------------------------------------------------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';

import {
    challengeAnswerRequestCodec,
    claimRequestCodec,
    claimResponseCodec,
    uploadCommitMetadataCodec,
} from '@fileshed/core';

//----------------------------------------------------------------------------------------------------------------------

describe('claimResponseCodec', () =>
{
    // an unknown blob answers with an upload ticket; a known one answers with a challenge.
    // The two shapes must be distinguishable by the `upload` literal alone.
    it('parses the upload-ticket variant', () =>
    {
        const result = claimResponseCodec.safeParse({ upload: true, ticket: 'ticket_1', chunkBytes: 8_388_608 });

        expect(result.success).toBe(true);
    });

    // The chunk size is how the client cuts the file it is about to send, and the deployment decides it. A ticket
    // without one leaves the client guessing at a number it was supposed to be told, so the ticket is not a ticket.
    it('rejects an upload ticket that omits the chunk size', () =>
    {
        const result = claimResponseCodec.safeParse({ upload: true, ticket: 'ticket_1' });

        expect(result.success).toBe(false);
    });

    it('rejects a chunk size of zero or fewer bytes, which could never finish a file', () =>
    {
        const zero = claimResponseCodec.safeParse({ upload: true, ticket: 'ticket_1', chunkBytes: 0 });
        const negative = claimResponseCodec.safeParse({ upload: true, ticket: 'ticket_1', chunkBytes: -1 });

        expect(zero.success).toBe(false);
        expect(negative.success).toBe(false);
    });

    it('parses the challenge variant', () =>
    {
        const result = claimResponseCodec.safeParse({
            upload: false,
            challengeID: 'challenge_1',
            nonce: 'nonce_1',
            ranges: [ [ 0, 128 ], [ 512, 64 ] ],
        });

        expect(result.success).toBe(true);
    });

    it('rejects a payload missing the upload discriminant entirely', () =>
    {
        const result = claimResponseCodec.safeParse({
            challengeID: 'challenge_1',
            nonce: 'nonce_1',
            ranges: [ [ 0, 128 ], [ 512, 64 ] ],
        });

        expect(result.success).toBe(false);
    });

    it('rejects a ticket response carrying challenge-only fields', () =>
    {
        const result = claimResponseCodec.safeParse({
            upload: true,
            ticket: 'ticket_1',
            chunkBytes: 8_388_608,
            nonce: 'nonce_1',
        });

        expect(result.success).toBe(false);
    });

    // 2-4 random ranges per challenge -- fewer defeats the point of a multi-range proof, more is unbounded
    // work for no security benefit.
    it('rejects a challenge with fewer than 2 ranges or more than 4', () =>
    {
        const tooFew = claimResponseCodec.safeParse({
            upload: false,
            challengeID: 'challenge_1',
            nonce: 'nonce_1',
            ranges: [ [ 0, 128 ] ],
        });
        const tooMany = claimResponseCodec.safeParse({
            upload: false,
            challengeID: 'challenge_1',
            nonce: 'nonce_1',
            ranges: [ [ 0, 1 ], [ 1, 1 ], [ 2, 1 ], [ 3, 1 ], [ 4, 1 ] ],
        });

        expect(tooFew.success).toBe(false);
        expect(tooMany.success).toBe(false);
    });
});

describe('claimRequestCodec', () =>
{
    // sha256 identifies the blob; anything other than 64 lowercase hex characters isn't a sha256.
    it('rejects a sha256 that is not 64 lowercase hex characters', () =>
    {
        const tooShort = claimRequestCodec.safeParse({ sha256: 'abc123', size: 10 });
        const uppercase = claimRequestCodec.safeParse({ sha256: 'A'.repeat(64), size: 10 });

        expect(tooShort.success).toBe(false);
        expect(uppercase.success).toBe(false);
    });
});

//----------------------------------------------------------------------------------------------------------------------
// Commit metadata -- two mutually exclusive modes: CREATE a new node (name + mimeType, parentID optional) or REPLACE
// an existing file's content (replaceNodeID, mimeType optional). The modes carry no literal tag, so they must be told
// apart by which fields are present, and supplying both modes' fields or neither's must be rejected.
//----------------------------------------------------------------------------------------------------------------------

describe('uploadCommitMetadataCodec', () =>
{
    it('accepts create metadata and defaults an absent parentID to root (null)', () =>
    {
        const result = uploadCommitMetadataCodec.safeParse({ name: 'report.pdf', mimeType: 'application/pdf' });

        expect(result.success).toBe(true);
        if(!result.success) { throw new Error('expected create metadata to parse'); }
        expect(result.data).toEqual({ name: 'report.pdf', parentID: null, mimeType: 'application/pdf' });
    });

    it('accepts create metadata with an explicit parent', () =>
    {
        const result = uploadCommitMetadataCodec.safeParse({
            name: 'nested.bin',
            parentID: 'folder_1',
            mimeType: 'application/octet-stream',
        });

        expect(result.success).toBe(true);
    });

    it('accepts replace metadata with only a target', () =>
    {
        const result = uploadCommitMetadataCodec.safeParse({ replaceNodeID: 'node_1' });

        expect(result.success).toBe(true);
        if(!result.success) { throw new Error('expected replace metadata to parse'); }
        expect(result.data).toEqual({ replaceNodeID: 'node_1' });
    });

    it('accepts replace metadata carrying an overriding mime type', () =>
    {
        const result = uploadCommitMetadataCodec.safeParse({ replaceNodeID: 'node_1', mimeType: 'text/plain' });

        expect(result.success).toBe(true);
    });

    // ifBlobID is the optional optimistic-concurrency guard: the blob the caller edited from. It rides replace metadata
    // and is preserved through the codec so the manager can compare it against the target's current blob at commit.
    it('accepts replace metadata carrying an ifBlobID concurrency guard', () =>
    {
        const result = uploadCommitMetadataCodec.safeParse({ replaceNodeID: 'node_1', ifBlobID: 'a'.repeat(64) });

        expect(result.success).toBe(true);
        if(!result.success) { throw new Error('expected replace metadata with a guard to parse'); }
        expect(result.data).toEqual({ replaceNodeID: 'node_1', ifBlobID: 'a'.repeat(64) });
    });

    // The guard is optional -- a replace without one is last-write-wins, so an absent ifBlobID must still parse and
    // must not appear in the parsed value.
    it('omits ifBlobID from parsed replace metadata when none is supplied', () =>
    {
        const result = uploadCommitMetadataCodec.safeParse({ replaceNodeID: 'node_1' });

        expect(result.success).toBe(true);
        if(!result.success) { throw new Error('expected replace metadata to parse'); }
        expect(result.data).toEqual({ replaceNodeID: 'node_1' });
    });

    // The guard belongs to replace mode only: create metadata is a strict object, so an ifBlobID smuggled onto a
    // create matches neither mode and is rejected.
    it('rejects create metadata carrying an ifBlobID', () =>
    {
        const result = uploadCommitMetadataCodec.safeParse({
            name: 'report.pdf',
            mimeType: 'application/pdf',
            ifBlobID: 'a'.repeat(64),
        });

        expect(result.success).toBe(false);
    });

    // Both modes at once is ambiguous: each mode's strict object rejects the other's key, so the union matches neither.
    it('rejects a payload carrying both modes\' fields', () =>
    {
        const result = uploadCommitMetadataCodec.safeParse({
            name: 'report.pdf',
            mimeType: 'application/pdf',
            replaceNodeID: 'node_1',
        });

        expect(result.success).toBe(false);
    });

    it('rejects a payload that completes neither mode', () =>
    {
        const empty = uploadCommitMetadataCodec.safeParse({});
        // A mimeType alone is neither a create (no name) nor a replace (no target).
        const orphanMime = uploadCommitMetadataCodec.safeParse({ mimeType: 'text/plain' });
        // A create missing its required mimeType is not a complete create, and carries no replace target either.
        const halfCreate = uploadCommitMetadataCodec.safeParse({ name: 'report.pdf' });

        expect(empty.success).toBe(false);
        expect(orphanMime.success).toBe(false);
        expect(halfCreate.success).toBe(false);
    });
});

describe('challengeAnswerRequestCodec', () =>
{
    it('accepts an answer with create metadata', () =>
    {
        const result = challengeAnswerRequestCodec.safeParse({
            answer: 'deadbeef',
            name: 'report.pdf',
            mimeType: 'application/pdf',
        });

        expect(result.success).toBe(true);
    });

    it('accepts an answer with replace metadata', () =>
    {
        const result = challengeAnswerRequestCodec.safeParse({ answer: 'deadbeef', replaceNodeID: 'node_1' });

        expect(result.success).toBe(true);
    });

    // The concurrency guard rides the challenge-answer transport too, since a proven dedup can replace a file's content
    // just as an upload can.
    it('accepts an answer with replace metadata carrying an ifBlobID guard', () =>
    {
        const result = challengeAnswerRequestCodec.safeParse({
            answer: 'deadbeef',
            replaceNodeID: 'node_1',
            ifBlobID: 'a'.repeat(64),
        });

        expect(result.success).toBe(true);
        if(!result.success) { throw new Error('expected a guarded replace answer to parse'); }
        expect(result.data).toEqual({ answer: 'deadbeef', replaceNodeID: 'node_1', ifBlobID: 'a'.repeat(64) });
    });

    it('rejects an answer carrying both modes, or neither', () =>
    {
        const both = challengeAnswerRequestCodec.safeParse({
            answer: 'deadbeef',
            name: 'report.pdf',
            mimeType: 'application/pdf',
            replaceNodeID: 'node_1',
        });
        const neither = challengeAnswerRequestCodec.safeParse({ answer: 'deadbeef' });

        expect(both.success).toBe(false);
        expect(neither.success).toBe(false);
    });
});

//----------------------------------------------------------------------------------------------------------------------
