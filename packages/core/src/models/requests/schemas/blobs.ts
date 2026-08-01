//----------------------------------------------------------------------------------------------------------------------
// Blob API Codecs
//----------------------------------------------------------------------------------------------------------------------

import { z } from 'zod';

// Constants
import { MAX_CHALLENGE_RANGES, MIN_CHALLENGE_RANGES } from '../../../constants/blob.ts';

// Requests
import type {
    ChallengeAnswerCreate,
    ChallengeAnswerReplace,
    ChallengeAnswerRequest,
    ClaimRequest,
    ClaimResponse,
    UploadCommitCreate,
    UploadCommitMetadata,
    UploadCommitReplace,
} from '../blobs.ts';

// Utils
import { type Equals, typeAssert } from '../../../utils/typeAssert.ts';

//----------------------------------------------------------------------------------------------------------------------

const sha256Pattern = /^[0-9a-f]{64}$/;

export const claimRequestCodec = z.strictObject({
    sha256: z.string().regex(sha256Pattern, 'sha256 must be 64 lowercase hex characters'),
    size: z.number()
        .int()
        .nonnegative(),
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

// [offset, length]. Ranges are random per challenge and several of them -- fixed ranges would be
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
        .min(MIN_CHALLENGE_RANGES)
        .max(MAX_CHALLENGE_RANGES),
});

export const claimResponseCodec = z.discriminatedUnion(
    'upload',
    [ claimTicketResponseCodec, claimChallengeResponseCodec ]
);

typeAssert<Equals<z.output<typeof claimResponseCodec>, ClaimResponse>>();

//----------------------------------------------------------------------------------------------------------------------

// The two commit modes are strict objects, so an unknown key from the other mode fails the branch outright: a payload
// carrying BOTH modes' fields matches neither (each rejects the other's keys) and a payload carrying NEITHER's
// required fields matches neither -- both collapse to a 400. No literal discriminant exists, so the modes are told
// apart by which fields are present, exactly as the domain union is.
export const uploadCommitCreateCodec = z.strictObject({
    name: z.string().min(1),
    parentID: z.string()
        .nullable()
        .optional()
        .default(null),
    mimeType: z.string().min(1),
});

typeAssert<Equals<z.output<typeof uploadCommitCreateCodec>, UploadCommitCreate>>();

export const uploadCommitReplaceCodec = z.strictObject({
    replaceNodeID: z.string().min(1),
    mimeType: z.string()
        .min(1)
        .optional(),
    ifBlobID: z.string()
        .min(1)
        .optional(),
});

typeAssert<Equals<z.output<typeof uploadCommitReplaceCodec>, UploadCommitReplace>>();

export const uploadCommitMetadataCodec = z.union([ uploadCommitCreateCodec, uploadCommitReplaceCodec ]);

typeAssert<Equals<z.output<typeof uploadCommitMetadataCodec>, UploadCommitMetadata>>();

export const challengeAnswerCreateCodec = z.strictObject({
    answer: z.string(),
    ...uploadCommitCreateCodec.shape,
});

typeAssert<Equals<z.output<typeof challengeAnswerCreateCodec>, ChallengeAnswerCreate>>();

export const challengeAnswerReplaceCodec = z.strictObject({
    answer: z.string(),
    ...uploadCommitReplaceCodec.shape,
});

typeAssert<Equals<z.output<typeof challengeAnswerReplaceCodec>, ChallengeAnswerReplace>>();

export const challengeAnswerRequestCodec = z.union([ challengeAnswerCreateCodec, challengeAnswerReplaceCodec ]);

typeAssert<Equals<z.output<typeof challengeAnswerRequestCodec>, ChallengeAnswerRequest>>();

//----------------------------------------------------------------------------------------------------------------------
