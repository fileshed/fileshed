//----------------------------------------------------------------------------------------------------------------------
// Blob Backend Interface
//
// The content-addressed byte store contract every backend implements. Blobs are addressed by their sha256 and this
// layer holds bytes only -- the blob table, dedup, and ref-counting live above it. Ranged reads are first-class so
// callers stream byte windows (HTTP Range responses, proof-of-possession challenges) without ever loading a whole blob
// into memory. The integrity and lookup failures a backend raises (HashMismatchError, SizeMismatchError,
// BlobNotFoundError, InvalidSha256Error) are the shared error vocabulary in @fileshed/core.
//----------------------------------------------------------------------------------------------------------------------

import type { Readable } from 'node:stream';

//----------------------------------------------------------------------------------------------------------------------

// A byte window into a blob. Both HTTP Range responses and proof-of-possession challenges address blobs this
// way; offset is the zero-based first byte, length the number of bytes.
export interface BlobRange
{
    offset : number;
    length : number;
}

// What one pass over the staging area did. Candidates are the staging areas past the cutoff; the uploads still inside
// it were never candidates and are counted nowhere. A candidate the backend could not drop is counted in `failed` and
// its size stays out of `bytesFreed` -- it is still occupying the space.
export interface StagedSweep
{
    candidates : number;
    reclaimed : number;
    failed : number;
    bytesFreed : number;
}

// One stored blob as the reconciler measures it: enough to date bytes nothing references and to report what dropping
// them reclaims.
export interface StoredBlobStat
{
    size : number;
    modifiedAt : Date;
}

export interface BlobBackend
{
    /**
     * Whether bytes are stored for this address. Never throws for an absent blob.
     *
     * @throws {InvalidSha256Error} when the address is not a well-formed lowercase 64-hex digest.
     */
    exists(sha256 : string) : Promise<boolean>;

    /**
     * Streams bytes into the store, hashing and counting WHILE writing -- never buffer the whole stream. On any
     * mismatch or stream error, nothing may remain on the backend (staging must be cleaned up): a lying client must not
     * poison the store. Writing an address that already exists is a no-op or an idempotent overwrite with identical
     * bytes -- content addressing guarantees equality, so either is legal. Publication must be atomic: a concurrent
     * reader sees the complete blob or BlobNotFoundError, never a partial.
     *
     * @throws {HashMismatchError} when the streamed bytes do not hash to `sha256`.
     * @throws {SizeMismatchError} when the streamed byte count differs from `size`.
     * @throws {InvalidSha256Error} when the address is malformed.
     */
    put(sha256 : string, stream : Readable, size : number) : Promise<void>;

    /**
     * Opens a read stream over the blob, or over one byte window of it. The range is served without reading bytes
     * outside the window (HTTP Range responses stay O(length), not O(blob)).
     *
     * @throws {BlobNotFoundError} when no bytes are stored at the address.
     * @throws {InvalidSha256Error} when the address is malformed.
     */
    getStream(sha256 : string, range ?: BlobRange) : Promise<Readable>;

    /**
     * Reads exactly the [offset, offset + length) window into a Buffer -- the proof-of-possession primitive. Must be a
     * positional read of the window alone, never the whole blob; challenge windows are small and this runs under a
     * 60-second challenge TTL.
     *
     * @throws {BlobNotFoundError} when no bytes are stored at the address.
     * @throws {InvalidSha256Error} when the address is malformed.
     */
    read(sha256 : string, offset : number, length : number) : Promise<Buffer>;

    /**
     * Removes the bytes. Idempotent: deleting an absent blob is a no-op, not an error -- GC may race an
     * already-collected blob.
     *
     * @throws {InvalidSha256Error} when the address is malformed.
     */
    delete(sha256 : string) : Promise<void>;

    //------------------------------------------------------------------------------------------------------------------
    // Reconciliation
    //
    // Bytes are published before the record that references them commits, so a store can hold blobs its records know
    // nothing about. These two let a caller walk what is actually stored and date anything the records have no answer
    // for, in bounded memory over a store of any size.
    //------------------------------------------------------------------------------------------------------------------

    /**
     * Every address the backend currently holds bytes for, streamed rather than collected. Order is unspecified, and
     * an address may already be gone by the time the caller acts on it. Anything the backend holds that is not a blob
     * -- staging areas, a backend's own bookkeeping -- is never yielded.
     */
    listStored() : AsyncIterable<string>;

    /**
     * Size and last-written time for one address, or null when nothing is stored there.
     *
     * @throws {InvalidSha256Error} when the address is malformed.
     */
    statStored(sha256 : string) : Promise<StoredBlobStat | null>;

    //------------------------------------------------------------------------------------------------------------------
    // Chunked uploads
    //
    // A file may arrive as a sequence of requests rather than one stream, so the backend holds the bytes of an
    // incomplete upload under a caller-chosen id until they add up to the claimed size. The staged bytes are not a blob
    // and are addressed by nothing: they become one only at commitChunked, which applies the same integrity contract
    // put does. `uploadID` is opaque -- a backend that derives a path or key from it owes the same guard put's address
    // gets.
    //------------------------------------------------------------------------------------------------------------------

    /**
     * Appends a chunk to the staged bytes of an upload, creating the staging area on the first one, and answers how
     * many bytes the stream carried. `offset` is where the caller believes the staged bytes end; a longer staging area
     * is truncated back to it first, which is what makes a torn append safe to retry -- the same chunk sent twice
     * leaves the same bytes either way. Staged bytes SHORTER than `offset` mean the staging area was lost underneath a
     * live upload; that is a server fault and must throw rather than write a hole.
     */
    appendChunk(uploadID : string, stream : Readable, offset : number) : Promise<number>;

    /**
     * Publishes the staged bytes as the blob at `sha256`, verifying them against the claimed hash and size first. The
     * staging area is consumed either way: on any mismatch nothing is published and nothing is left behind, exactly as
     * a rejected put leaves nothing.
     *
     * @throws {HashMismatchError} when the staged bytes do not hash to `sha256`.
     * @throws {SizeMismatchError} when the staged byte count differs from `size`.
     * @throws {InvalidSha256Error} when the address is malformed.
     */
    commitChunked(uploadID : string, sha256 : string, size : number) : Promise<void>;

    /**
     * Drops an upload's staged bytes. Idempotent: discarding an upload that never staged anything is a no-op.
     */
    discardChunked(uploadID : string) : Promise<void>;

    /**
     * Drops every staging area untouched since `cutoff` and answers what that reclaimed, so an upload abandoned
     * mid-flight cannot leak bytes forever. The caller owns the cutoff and must set it past the window in which a chunk
     * can still legally land. One staging area the backend cannot drop is reported, never thrown: the rest of the
     * abandoned staging must still go.
     */
    sweepChunked(cutoff : Date) : Promise<StagedSweep>;
}

//----------------------------------------------------------------------------------------------------------------------
