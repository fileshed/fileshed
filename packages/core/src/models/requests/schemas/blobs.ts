//----------------------------------------------------------------------------------------------------------------------
// Blob API Codecs
//----------------------------------------------------------------------------------------------------------------------

import { z } from 'zod';

// Requests
import type { ChallengeAnswerRequest, ClaimRequest, ClaimResponse, UploadCommitMetadata } from '../blobs.ts';

// Utils
import { type Equals, typeAssert } from '../../../utils/typeAssert.ts';

//----------------------------------------------------------------------------------------------------------------------

const sha256Pattern = /^[0-9a-f]{64}$/;

export const claimRequestCodec = z.strictObject({
    sha256: z.string().regex(sha256Pattern, 'sha256 must be 64 lowercase hex characters'),
    size: z.number()
        .int()
        .positive(),
});

typeAssert<Equals<z.output<typeof claimRequestCodec>, ClaimRequest>>();

//----------------------------------------------------------------------------------------------------------------------
// Claim response -- an unknown blob gets an upload ticket; a known blob (including graveyarded) gets a proof-of-
// possession challenge instead of a place to put bytes. The two shapes are told apart by the `upload` literal the
// client switches on, not by probing for which keys exist.
//----------------------------------------------------------------------------------------------------------------------

const claimTicketResponseCodec = z.strictObject({
    upload: z.literal(true),
    ticket: z.string(),
});

// [offset, length]. Ranges are random per challenge and 2-4 of them -- fixed ranges would be harvest-and-replay-able,
// which is exactly what the challenge exists to prevent.
const rangeOffsetCodec = z.number()
    .int()
    .nonnegative();

const rangeLengthCodec = z.number()
    .int()
    .positive();

const byteRangeCodec = z.tuple([ rangeOffsetCodec, rangeLengthCodec ]);

const claimChallengeResponseCodec = z.strictObject({
    upload: z.literal(false),
    challengeID: z.string(),
    nonce: z.string(),
    ranges: z.array(byteRangeCodec)
        .min(2)
        .max(4),
});

export const claimResponseCodec = z.discriminatedUnion(
    'upload',
    [ claimTicketResponseCodec, claimChallengeResponseCodec ]
);

typeAssert<Equals<z.output<typeof claimResponseCodec>, ClaimResponse>>();

//----------------------------------------------------------------------------------------------------------------------

export const uploadCommitMetadataCodec = z.strictObject({
    name: z.string().min(1),
    parentID: z.string()
        .nullable()
        .optional()
        .default(null),
    mimeType: z.string().min(1),
});

typeAssert<Equals<z.output<typeof uploadCommitMetadataCodec>, UploadCommitMetadata>>();

export const challengeAnswerRequestCodec = z.strictObject({
    answer: z.string(),
    ...uploadCommitMetadataCodec.shape,
});

typeAssert<Equals<z.output<typeof challengeAnswerRequestCodec>, ChallengeAnswerRequest>>();

//----------------------------------------------------------------------------------------------------------------------
