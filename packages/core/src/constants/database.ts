//----------------------------------------------------------------------------------------------------------------------
// Database Constants
//----------------------------------------------------------------------------------------------------------------------

// How long a SQLite connection waits out a competing writer before surfacing SQLITE_BUSY to the caller. node:sqlite
// opens with no timeout whatsoever, so the pragma carrying this value is the only thing standing there.
export const SQLITE_BUSY_TIMEOUT_MS = 5000;

// The SQLite page cache, in the pragma's own units: negative is KiB, positive is a page count. 16,000 KiB.
export const SQLITE_CACHE_SIZE = -16_000;

//----------------------------------------------------------------------------------------------------------------------
