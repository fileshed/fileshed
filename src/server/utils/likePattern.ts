//----------------------------------------------------------------------------------------------------------------------
// LIKE Pattern Escaping
//----------------------------------------------------------------------------------------------------------------------

// Escape the LIKE metacharacters in a user's search term so "50%" or "a_b" match literally rather than as wildcards.
// Backslash is the escape character (declared with ESCAPE in the query), so escape it first to avoid double-escaping.
export function escapeLikePattern(term : string) : string
{
    return term.replace(/[\\%_]/g, (char) => `\\${ char }`);
}

//----------------------------------------------------------------------------------------------------------------------
