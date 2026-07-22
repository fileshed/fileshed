//----------------------------------------------------------------------------------------------------------------------
// File Extension
//
// Ensures a file name carries its extension -- for the names the new-document prompt produces. The check is
// case-insensitive but preserves the name the user typed, so "notes" becomes "notes.md" while "README.MD" is left
// exactly as entered.
//----------------------------------------------------------------------------------------------------------------------

export function ensureExtension(name : string, extension : string) : string
{
    const trimmed = name.trim();

    return trimmed.toLowerCase().endsWith(extension.toLowerCase()) ? trimmed : `${ trimmed }${ extension }`;
}

//----------------------------------------------------------------------------------------------------------------------
