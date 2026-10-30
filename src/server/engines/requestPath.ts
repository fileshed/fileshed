//----------------------------------------------------------------------------------------------------------------------
// Request Path Engine
//
// The reading of a request path that every path-keyed guard matches against. It has to decode at least what the router
// decodes: a guard that a spelling reaches past while the router still routes it is no guard.
//----------------------------------------------------------------------------------------------------------------------

function decodePath(pathname : string) : string
{
    try { return decodeURIComponent(pathname); }
    catch
    {
        // One malformed sequence fails the whole decode, but the router still decodes every well-formed run around it.
        // Matching the raw path instead would let a stray `%` hide `/%61pi/...` from the guard.
        return pathname.replace(/(?:%[0-9A-Fa-f]{2})+/g, (run) =>
        {
            try { return decodeURIComponent(run); }
            catch { return run; }
        });
    }
}

// Percent-decoded (slashes included, so an encoded one cannot hide a segment), repeated slashes collapsed, lowercased.
// Every step widens what a prefix matches, never narrows it.
export function normalizeRequestPath(pathname : string) : string
{
    return decodePath(pathname)
        .replace(/\/{2,}/g, '/')
        .toLowerCase();
}

// The prefix itself or anything beneath it: `/api/auth/admin` covers `/api/auth/admin/x` but not
// `/api/auth/administrator`.
export function pathWithin(path : string, prefix : string) : boolean
{
    return path === prefix || path.startsWith(`${ prefix }/`);
}

//----------------------------------------------------------------------------------------------------------------------
