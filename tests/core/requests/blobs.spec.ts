//----------------------------------------------------------------------------------------------------------------------
// Blob DTOs -- the claim response discriminated union and its range-count invariant
//----------------------------------------------------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';

import { claimRequestCodec, claimResponseCodec } from '@fileshed/core';

//----------------------------------------------------------------------------------------------------------------------

describe('claimResponseCodec', () =>
{
    // requirements.md sec 4.3: an unknown blob answers with an upload ticket; a known one answers with a challenge.
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

    // sec 4.3: 2-4 random ranges per challenge -- fewer defeats the point of a multi-range proof, more is unbounded
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
    // sec 4.3: sha256 identifies the blob; anything other than 64 lowercase hex characters isn't a sha256.
    it('rejects a sha256 that is not 64 lowercase hex characters', () =>
    {
        const tooShort = claimRequestCodec.safeParse({ sha256: 'abc123', size: 10 });
        const uppercase = claimRequestCodec.safeParse({ sha256: 'A'.repeat(64), size: 10 });

        expect(tooShort.success).toBe(false);
        expect(uppercase.success).toBe(false);
    });
});

//----------------------------------------------------------------------------------------------------------------------
