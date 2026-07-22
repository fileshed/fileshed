//----------------------------------------------------------------------------------------------------------------------
// Copy Name
//
// The next "keep both" candidate name when an upload collides with an existing file. A bare name gains a " (1)"
// suffix; an already-suffixed name bumps its number ("report (1).txt" -> "report (2).txt"). The suffix sits before the
// extension, and the extension is the last dot segment -- except a leading dot is part of the name, so a dotfile like
// ".gitignore" is treated as extensionless. Pure: the caller probes each candidate against the folder and calls again
// on a hit.
//----------------------------------------------------------------------------------------------------------------------

//----------------------------------------------------------------------------------------------------------------------

// Split into [ base, extension ]. The extension is the final ".xyz", but only when the dot is not the first character
// (a leading dot names a dotfile, it does not open an extension) -- so "archive.tar.gz" splits to
// [ "archive.tar", ".gz" ] and ".gitignore" to [ ".gitignore", "" ].
function splitExtension(name : string) : [ string, string ]
{
    const dot = name.lastIndexOf('.');
    if(dot <= 0) { return [ name, '' ]; }

    return [ name.slice(0, dot), name.slice(dot) ];
}

//----------------------------------------------------------------------------------------------------------------------

export function nextCopyName(name : string) : string
{
    const [ base, extension ] = splitExtension(name);

    const suffixed = /^(.*) \((\d+)\)$/.exec(base);
    const nextBase = suffixed
        ? `${ suffixed[1] } (${ Number(suffixed[2]) + 1 })`
        : `${ base } (1)`;

    return `${ nextBase }${ extension }`;
}

//----------------------------------------------------------------------------------------------------------------------
