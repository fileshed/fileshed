//----------------------------------------------------------------------------------------------------------------------
// Request Origin Engine
//
// Whether a state-changing API request may proceed given where the browser says it came from.
//
// A cross-site form post carries the attacker's Origin and the target's Host, because the browser sets both and a page
// cannot lie about either. Comparing them is therefore the whole check. Scheme is left out of it: a TLS-terminating
// proxy speaks http to us while the browser speaks https, and refusing that would refuse the standard deployment.
//----------------------------------------------------------------------------------------------------------------------

// Models
import { ANY_HOST } from '@fileshed/core';

//----------------------------------------------------------------------------------------------------------------------

const mutatingMethods = new Set([ 'POST', 'PUT', 'PATCH', 'DELETE' ]);

export interface OriginCheckInput
{
    method : string;
    pathname : string;

    // The Origin header verbatim, or null when the request carries none.
    origin : string | null;

    // The host this request was addressed to, as the server received it.
    host : string | null;

    // Further origins the instance answers on, for a browser client served from somewhere else.
    allowedOrigins : readonly string[];
}

function hostOf(origin : string) : string | null
{
    try
    {
        const url = new URL(origin);

        return url.protocol === 'http:' || url.protocol === 'https:' ? url.host : null;
    }
    catch
    {
        return null;
    }
}

function guardsRequest(method : string, pathname : string) : boolean
{
    return mutatingMethods.has(method.toUpperCase()) && (pathname === '/api' || pathname.startsWith('/api/'));
}

export function originAllowed(input : OriginCheckInput) : boolean
{
    if(!guardsRequest(input.method, input.pathname)) { return true; }

    // No Origin at all is not a browser making a cross-site request -- it is curl, a CLI, or a gateway. The header is
    // mandatory on exactly the requests this defends against, so its absence is not the case to refuse.
    if(input.origin === null) { return true; }

    const origin = hostOf(input.origin);

    // Present but not an http(s) origin: `null` from a sandboxed frame, or a scheme with no origin at all. Nothing
    // legitimate reaches an API this way.
    if(origin === null) { return false; }

    if(input.host !== null && origin === input.host) { return true; }

    // The deployment said it answers anywhere, so there is no cross-site request left to refuse.
    if(input.allowedOrigins.includes(ANY_HOST)) { return true; }

    return input.allowedOrigins.some((allowed) => hostOf(allowed) === origin);
}

//----------------------------------------------------------------------------------------------------------------------
