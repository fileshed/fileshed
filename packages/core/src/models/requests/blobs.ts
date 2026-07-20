//----------------------------------------------------------------------------------------------------------------------
// Blob API DTOs
//
// Request/response contracts for the claim/proof-of-possession/upload flow (requirements.md sec 4.3). The claim
// response is a discriminated union on `upload`: a known blob answers with a challenge instead of a ticket, so the two
// shapes are told apart by a literal the client can switch on, not by probing for which keys exist.
//----------------------------------------------------------------------------------------------------------------------

import { z } from 'zod';

//----------------------------------------------------------------------------------------------------------------------

const sha256Pattern = /^[0-9a-f]{64}$/;

export const claimRequestCodec = z.strictObject({
    sha256: z.string().regex(sha256Pattern, 'sha256 must be 64 lowercase hex characters'),
    size: z.number()
        .int()
        .positive(),
});

export type ClaimRequest = z.infer<typeof claimRequestCodec>;

//----------------------------------------------------------------------------------------------------------------------
// Claim response -- an unknown blob gets an upload ticket; a known blob (including graveyarded) gets a proof-of-
// possession challenge instead of a place to put bytes.
//----------------------------------------------------------------------------------------------------------------------

const claimTicketResponseCodec = z.strictObject({
    upload: z.literal(true),
    ticket: z.string(),
});

// [offset, length]. Ranges are random per challenge and 2-4 of them (sec 4.3) -- fixed ranges would be
// harvest-and-replay-able, which is exactly what the challenge exists to prevent.
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

export type ClaimResponse = z.infer<typeof claimResponseCodec>;

//----------------------------------------------------------------------------------------------------------------------
// Placement metadata for the file node a completed upload or an answered challenge creates (sec 4.3 steps 3/5).
// Shared by both commit paths so the resulting node's name/parent/mimeType are validated identically either way.
//----------------------------------------------------------------------------------------------------------------------

export const uploadCommitMetadataCodec = z.strictObject({
    name: z.string().min(1),
    parentID: z.string()
        .nullable()
        .optional()
        .default(null),
    mimeType: z.string().min(1),
});

export type UploadCommitMetadata = z.infer<typeof uploadCommitMetadataCodec>;

//----------------------------------------------------------------------------------------------------------------------
// POST /api/blobs/claim/:challengeId -- the HMAC answer plus the placement metadata, since a successful proof commits
// the node in the same round trip and zero bytes are uploaded (sec 4.3 step 5).
//----------------------------------------------------------------------------------------------------------------------

export const challengeAnswerRequestCodec = z.strictObject({
    answer: z.string(),
    ...uploadCommitMetadataCodec.shape,
});

export type ChallengeAnswerRequest = z.infer<typeof challengeAnswerRequestCodec>;

//----------------------------------------------------------------------------------------------------------------------
