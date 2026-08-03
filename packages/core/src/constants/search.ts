//----------------------------------------------------------------------------------------------------------------------
// Search Constants
//----------------------------------------------------------------------------------------------------------------------

// A location line renders at most this many segments -- the root anchor, an ellipsis where the middle was dropped, and
// the folders nearest the file, which are the ones that actually tell a reader where it lives. Deep chains otherwise
// push the name out of a result row entirely.
export const MAX_LOCATION_SEGMENTS = 4;

// Typing pauses this long before the search box asks the server for suggestions, so a burst of keystrokes costs one
// query rather than one per character.
export const SUGGEST_DEBOUNCE_MS = 200;

// One or two characters match nearly everything, which is noise rather than a suggestion.
export const MIN_SUGGEST_CHARS = 2;

// A dropdown is a shortcut, not a results page; anything longer wants the full search.
export const SUGGEST_LIMIT = 6;

//----------------------------------------------------------------------------------------------------------------------
