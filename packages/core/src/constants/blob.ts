//----------------------------------------------------------------------------------------------------------------------
// Blob Protocol Constants
//
// The claim/proof-of-possession parameters of the upload flow. The client leans on several of these too: the
// small-file threshold decides its hash-then-claim UX, and the challenge TTL bounds how long it has to answer. A
// deployment can override the chunk size, so that one sits with the config defaults instead.
//----------------------------------------------------------------------------------------------------------------------

import { MS_PER_MINUTE, MS_PER_SECOND } from './time.ts';

//----------------------------------------------------------------------------------------------------------------------

// Below this size a known blob is re-uploaded instead of challenged -- round trips cost more than the bytes.
export const SMALL_FILE_THRESHOLD_BYTES = 1024 * 1024;

export const TICKET_TTL_MS = 30 * MS_PER_MINUTE;

// The most uploads one account may have outstanding at once. What bounds the disk is that a ticket's claimed bytes are
// held against its owner's quota from the moment it is issued; this bounds the bookkeeping, so an account that claims
// and never uploads cannot grow the server's heap. Generous against real use: a client moves a handful of files at a
// time, and a ticket an abandoned upload left behind stands until its TTL rather than being handed back.
export const MAX_OUTSTANDING_TICKETS = 64;

export const CHALLENGE_TTL_MS = 60 * MS_PER_SECOND;

export const MIN_CHALLENGE_RANGES = 2;
export const MAX_CHALLENGE_RANGES = 4;

// Randomness of the offsets across the whole blob is the security property, not window size -- the cap keeps a proof
// over a multi-gigabyte blob down to kilobytes of reads.
export const MAX_CHALLENGE_RANGE_BYTES = 64 * 1024;

export const NONCE_BYTES = 32;

export const MAX_FAILED_PROOFS = 10;
export const FAILED_PROOF_WINDOW_MS = 15 * MS_PER_MINUTE;

// How often the in-memory bookkeeping is pruned: expired tickets, spent challenges, lapsed failed-proof counts. It
// costs a walk of three small maps, so it is cheap enough to run often and only ever reclaims heap.
export const EXPIRY_PRUNE_INTERVAL_MS = 60 * MS_PER_SECOND;

// How often abandoned upload staging is reclaimed from disk. Deliberately far shorter than the database sweeps: one
// abandoned upload can be holding gigabytes, and finding out costs a readdir of the staging directory. What bounds
// how long those bytes linger is this plus TICKET_TTL_MS, not this alone.
export const PARTIALS_SWEEP_INTERVAL_MS = 60 * MS_PER_SECOND;

//----------------------------------------------------------------------------------------------------------------------
// Store reconciliation
//----------------------------------------------------------------------------------------------------------------------

// How long stored bytes no record points at must sit untouched before they count as orphaned. Bytes are published
// before the record referencing them commits, so this window has to clear the gap between the two -- a whole commit
// transaction -- by a margin nothing plausible closes.
export const ORPHAN_GRACE_MS = 60 * MS_PER_MINUTE;

// How many stored addresses are checked against the record table per query. Bounds both one query's parameter list and
// what the walk holds in memory over a store of any size.
export const ORPHAN_LOOKUP_BATCH = 500;

//----------------------------------------------------------------------------------------------------------------------
// Chunk retry budget
//----------------------------------------------------------------------------------------------------------------------

// Attempts per chunk against the transport, the first included: the request that never reached the server, and the
// server that broke while answering. Neither says anything about the bytes, and neither is promised to clear, so the
// budget is small and the backoff long.
export const UPLOAD_CHUNK_MAX_ATTEMPTS = 3;

// Backoff before re-sending a chunk the transport lost, multiplied by the attempt number.
export const UPLOAD_CHUNK_RETRY_DELAY_MS = 500;

// Attempts per chunk against the ticket being busy, the first included, on a budget of its own: a chunk the server is
// still receiving is the torn attempt's own dead request, so the tear has already spent one of the transport's
// attempts and the refusal that follows would be paying for it twice.
//
// This wait ends by itself, which is what buys it the wider budget and the closer first look. It runs to single-digit
// milliseconds against an idle host and into the hundreds against a saturated one moving multi-megabyte chunks; eight
// attempts spread over the delay below stay several times clear of the worst of that, and cost nothing when the
// window has already closed -- which it usually has by the time the torn request's own failure reaches the client.
export const UPLOAD_CHUNK_IN_FLIGHT_MAX_ATTEMPTS = 8;

// Backoff before looking again at a ticket still receiving a chunk, multiplied by the attempt number.
export const UPLOAD_CHUNK_IN_FLIGHT_RETRY_DELAY_MS = 100;

//----------------------------------------------------------------------------------------------------------------------
