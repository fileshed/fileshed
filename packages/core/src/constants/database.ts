//----------------------------------------------------------------------------------------------------------------------
// Database Constants
//
// Both values match what better-sqlite3 currently opens a connection with. They are stated here, and applied as
// explicit pragmas, so the deployment's behaviour is a decision rather than a driver default that a version bump or a
// differently-compiled build can move without notice.
//----------------------------------------------------------------------------------------------------------------------

// How long a SQLite connection waits out a competing writer before surfacing SQLITE_BUSY to the caller.
export const SQLITE_BUSY_TIMEOUT_MS = 5000;

// The SQLite page cache, in the pragma's own units: negative is KiB, positive is a page count. 16,000 KiB.
export const SQLITE_CACHE_SIZE = -16_000;

// How many compiled statements a SQLite connection keeps around. Kysely emits a bounded set of parameterized SQL, so
// the working set is far smaller than this and the cap only exists to bound a pathological one.
export const SQLITE_STATEMENT_CACHE_SIZE = 256;

//----------------------------------------------------------------------------------------------------------------------
