//----------------------------------------------------------------------------------------------------------------------
// Session Constants
//----------------------------------------------------------------------------------------------------------------------

// How long the signed session cookie is served without consulting the database. It lives in the browser, so this is
// also the window a revoked session (a ban) keeps working -- shortening it costs a session read per user per window.
export const SESSION_COOKIE_CACHE_SECONDS = 60;

//----------------------------------------------------------------------------------------------------------------------
