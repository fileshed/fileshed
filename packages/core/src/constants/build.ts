//----------------------------------------------------------------------------------------------------------------------
// Build Constants
//----------------------------------------------------------------------------------------------------------------------

// Long enough to name one commit in this repository, short enough to read in a menu label.
export const SHORT_COMMIT_LENGTH = 7;

// The git probe runs at boot, before the server answers anything, so it waits a bounded time rather than forever.
export const GIT_PROBE_TIMEOUT_MS = 2000;

//----------------------------------------------------------------------------------------------------------------------
