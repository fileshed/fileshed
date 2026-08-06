//----------------------------------------------------------------------------------------------------------------------
// Public Link URL
//----------------------------------------------------------------------------------------------------------------------

// A public link's full, shareable address: the `/d/<token>` path the server hands back, resolved against the app's own
// origin so a recipient can paste it anywhere. One token backs both forms -- the download flag is what asks the
// recipient's browser to save the file rather than render it.
export function publicLinkUrl(path : string, download = false) : string
{
    return `${ window.location.origin }${ path }${ download ? '?download' : '' }`;
}

//----------------------------------------------------------------------------------------------------------------------
