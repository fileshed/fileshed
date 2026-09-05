//----------------------------------------------------------------------------------------------------------------------
// Pagination Constants
//----------------------------------------------------------------------------------------------------------------------

// How much of a listing one request carries, and the largest page any listing endpoint will serve. The client asks for
// exactly this and keeps asking until the listing is in hand, so a folder at or under one chunk -- nearly every real
// one -- arrives in a single round trip.
export const LISTING_CHUNK_SIZE = 1000;

// The largest listing the client pulls to completion. A bigger one loads on demand as the viewport moves and keeps
// sorting and filtering on the server, where a listing that size belongs.
export const MAX_COMPLETE_LISTING = 50_000;

// Where SQLite stops ordering names naturally. Natural ordering happens in Node on that dialect -- SQLite has no ICU
// collation to sort by -- so the whole folder's names must be in memory at once, which costs about 0.3KB per row:
// 31MB and 86ms at 100,000 rows, 380MB and 1.0s at a million. Past this many children the listing falls back to the
// indexed lexical ordering it had before, so a folder that large degrades to alphabetical rather than loading whole.
// Postgres has no such limit: its collation orders inside the index.
export const SQLITE_MAX_SORTED_IN_MEMORY = 100_000;

// How many rows ahead of the loaded edge the viewport may come before the next chunk is asked for. A listing past the
// ceiling rides on this, and so does one whose background fill stopped on a failed chunk.
export const LISTING_FETCH_MARGIN = 100;

// How many matches one search gathers before paginating them. The query is already scoped to what the caller can
// reach, so this bounds THEIR matches: generous enough that real searches page fully, bounded so a one-letter term
// against a large tree still answers in one round trip.
export const SEARCH_CANDIDATE_LIMIT = 1000;

//----------------------------------------------------------------------------------------------------------------------

export const DEFAULT_CHILDREN_LIMIT = 50;
export const MAX_CHILDREN_LIMIT = LISTING_CHUNK_SIZE;

export const DEFAULT_LIST_USERS_LIMIT = 50;
export const MAX_LIST_USERS_LIMIT = 100;

export const DEFAULT_SEARCH_LIMIT = 50;

// A search never surfaces more hits than the candidate cap, so that cap is also the largest page a caller may ask
// for: one request answers any search in full.
export const MAX_SEARCH_LIMIT = SEARCH_CANDIDATE_LIMIT;

//----------------------------------------------------------------------------------------------------------------------
