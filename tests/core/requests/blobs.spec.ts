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
        const result = claimResponseCodec.safeParse({ upload: true, ticket: 'ticket_1' });

        expect(result.success).toBe(true);
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
        const result = claimResponseCodec.safeParse({ upload: true, ticket: 'ticket_1', nonce: 'nonce_1' });

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
