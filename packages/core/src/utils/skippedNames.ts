//----------------------------------------------------------------------------------------------------------------------
// Skipped Upload Names
//
// The one statement of which filenames an instance refuses to store, read by both tiers: the client skips them before
// any bytes move, and the upload commit refuses them so a client that never opened a browser is held to the same list.
//
// A pattern is a filename with `*` standing for any run of characters, matched against the name alone and never the
// path. Case is ignored, because the systems that produce this junk do not agree on it -- a Mac writes .DS_Store and
// a Windows share can hand back .ds_store for the same file.
//----------------------------------------------------------------------------------------------------------------------

//----------------------------------------------------------------------------------------------------------------------

// Comma-separated so one setting holds the list and an admin edits it as a sentence. Blank entries are dropped rather
// than treated as a pattern matching everything.
export function parseSkippedNames(patterns : string) : string[]
{
    return patterns.split(',')
        .map((pattern) => pattern.trim())
        .filter((pattern) => pattern !== '');
}

// `*` is the only metacharacter; everything else in a pattern stands for itself, so a name carrying a regex character
// cannot turn a pattern into something else.
function patternMatcher(pattern : string) : RegExp
{
    const source = pattern
        .split('*')
        .map((literal) => literal.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'))
        .join('.*');

    return new RegExp(`^${ source }$`, 'iu');
}

export function isSkippedName(name : string, patterns : readonly string[]) : boolean
{
    return patterns.some((pattern) => patternMatcher(pattern).test(name));
}

//----------------------------------------------------------------------------------------------------------------------
