//----------------------------------------------------------------------------------------------------------------------
// Blob Protocol Constants
//
// The claim/proof-of-possession parameters of the upload flow. The client leans on several of these too: the
// small-file threshold decides its hash-then-claim UX, and the challenge TTL bounds how long it has to answer.
//----------------------------------------------------------------------------------------------------------------------

import { MS_PER_MINUTE, MS_PER_SECOND } from './time.ts';

//----------------------------------------------------------------------------------------------------------------------

// Below this size a known blob is re-uploaded instead of challenged -- round trips cost more than the bytes.
export const SMALL_FILE_THRESHOLD_BYTES = 1024 * 1024;

export const TICKET_TTL_MS = 30 * MS_PER_MINUTE;

export const CHALLENGE_TTL_MS = 60 * MS_PER_SECOND;

export const MIN_CHALLENGE_RANGES = 2;
export const MAX_CHALLENGE_RANGES = 4;

// Randomness of the offsets across the whole blob is the security property, not window size -- the cap keeps a proof
// over a multi-gigabyte blob down to kilobytes of reads.
export const MAX_CHALLENGE_RANGE_BYTES = 64 * 1024;

export const NONCE_BYTES = 32;

export const MAX_FAILED_PROOFS = 10;
export const FAILED_PROOF_WINDOW_MS = 15 * MS_PER_MINUTE;

export const SWEEP_INTERVAL_MS = 60 * MS_PER_SECOND;

//----------------------------------------------------------------------------------------------------------------------
