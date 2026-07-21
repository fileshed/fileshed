//----------------------------------------------------------------------------------------------------------------------
// Pagination Constants
//----------------------------------------------------------------------------------------------------------------------

export const DEFAULT_CHILDREN_LIMIT = 50;
export const MAX_CHILDREN_LIMIT = 200;

export const DEFAULT_LIST_USERS_LIMIT = 50;
export const MAX_LIST_USERS_LIMIT = 100;

export const DEFAULT_SEARCH_LIMIT = 50;
export const MAX_SEARCH_LIMIT = 200;

// Accessibility can't be pushed into the SQL pagination -- the permission resolver is a per-node recursive walk -- so
// a search over-fetches this many name-matches, scopes them to the caller, then paginates the survivors. Generous
// enough that real searches page fully, bounded so a common term can't fan one query across every tree into an
// unbounded resolve.
export const SEARCH_CANDIDATE_LIMIT = 1000;

//----------------------------------------------------------------------------------------------------------------------
