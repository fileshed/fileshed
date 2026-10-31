//----------------------------------------------------------------------------------------------------------------------
// Ensure Extension
//----------------------------------------------------------------------------------------------------------------------

export function ensureExtension(name : string, extension : string) : string
{
    const trimmed = name.trim();

    return trimmed.toLowerCase().endsWith(extension.toLowerCase()) ? trimmed : `${ trimmed }${ extension }`;
}

//----------------------------------------------------------------------------------------------------------------------
