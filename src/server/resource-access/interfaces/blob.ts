//----------------------------------------------------------------------------------------------------------------------
// Blob Backend Interface
//
// The content-addressed byte store contract every backend implements (requirements.md sec 4.1). Blobs are addressed by
// their sha256 and this layer holds bytes only -- the blob table, dedup, and ref-counting (sec 4.2) live above it.
// Ranged reads are first-class so callers stream byte windows (HTTP Range responses, proof-of-possession challenges)
// without ever loading a whole blob into memory. The integrity and lookup failures a backend raises (HashMismatchError,
// SizeMismatchError, BlobNotFoundError, InvalidSha256Error) are the shared error vocabulary in @fileshed/core.
//----------------------------------------------------------------------------------------------------------------------

import type { Readable } from 'node:stream';

//----------------------------------------------------------------------------------------------------------------------

// A byte window into a blob. Both HTTP Range responses and proof-of-possession challenges (sec 4.1) address blobs this
// way; offset is the zero-based first byte, length the number of bytes.
export interface BlobRange
{
    offset : number;
    length : number;
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
     * mismatch or stream error, nothing may remain on the backend (staging must be cleaned up): a lying client must
     * not poison the store (requirements.md sec 4.3). Writing an address that already exists is a no-op or an
     * idempotent overwrite with identical bytes -- content addressing guarantees equality, so either is legal.
     * Publication must be atomic: a concurrent reader sees the complete blob or BlobNotFoundError, never a partial.
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
     * Reads exactly the [offset, offset + length) window into a Buffer -- the proof-of-possession primitive
     * (requirements.md sec 4.3). Must be a positional read of the window alone, never the whole blob; challenge
     * windows are small and this runs under a 60-second challenge TTL.
     *
     * @throws {BlobNotFoundError} when no bytes are stored at the address.
     * @throws {InvalidSha256Error} when the address is malformed.
     */
    read(sha256 : string, offset : number, length : number) : Promise<Buffer>;

    /**
     * Removes the bytes. Idempotent: deleting an absent blob is a no-op, not an error -- GC may race an
     * already-collected blob (requirements.md sec 4.2).
     *
     * @throws {InvalidSha256Error} when the address is malformed.
     */
    delete(sha256 : string) : Promise<void>;
}

//----------------------------------------------------------------------------------------------------------------------
