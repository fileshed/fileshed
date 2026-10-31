//----------------------------------------------------------------------------------------------------------------------
// Auth Gate Middleware
//
// better-auth's admin() plugin is enabled for its machinery, but its HTTP surface (/api/auth/admin/*) is refused before
// the auth mount ever sees it, so the only admin surface reachable from outside is ours (/api/admin/*). The api-key
// plugin's stock endpoints are refused the same way. Server-side auth.api.* calls never traverse HTTP, so internal
// minting is unaffected.
//----------------------------------------------------------------------------------------------------------------------

import type { MiddlewareHandler } from 'hono';

// Engines
import { normalizeRequestPath, pathWithin } from '../../../engines/requestPath.ts';

//----------------------------------------------------------------------------------------------------------------------

// Plugin HTTP surfaces refused externally: the admin plugin's routes (our /api/admin is the only admin surface) and the
// api-key plugin's stock endpoints (create there would mint unscoped keys outside our vocabulary; the only
// key-management surface is /api/me/access-tokens). Matched adversarially, since a single bypass reopens the whole
// plugin: the path is percent-decoded (so `admin%2Flist-users` cannot slip through as one segment), collapsed on
// repeated slashes (`/api/auth//admin`), and lowercased (`/ADMIN/`), then tested against the prefixes. Blocking a
// superset of the plugins' real routes is the safe direction for a gate.
const gatedAuthPrefixes = [ '/api/auth/admin', '/api/auth/api-key' ];

const signUpPrefix = '/api/auth/sign-up';

//----------------------------------------------------------------------------------------------------------------------

export function targetsGatedAuthSurface(pathname : string) : boolean
{
    const path = normalizeRequestPath(pathname);

    return gatedAuthPrefixes.some((prefix) => pathWithin(path, prefix));
}

export function targetsSignUpSurface(pathname : string) : boolean
{
    return pathWithin(normalizeRequestPath(pathname), signUpPrefix);
}

// Registered ahead of the auth mount. The sign-up switch is read per request so flipping it needs no restart; the
// first-run wizard is unaffected, since it creates its admin through a server-side auth.api call.
export function createAuthGate(signUpEnabled : () => Promise<boolean>) : MiddlewareHandler
{
    return async (ctx, next) =>
    {
        const pathname = new URL(ctx.req.url).pathname;

        if(targetsGatedAuthSurface(pathname))
        {
            return ctx.json({ error: 'Not Found' }, 404);
        }

        if(targetsSignUpSurface(pathname) && !(await signUpEnabled()))
        {
            return ctx.json({ error: 'Sign-ups are disabled on this instance.' }, 403);
        }

        return next();
    };
}

//----------------------------------------------------------------------------------------------------------------------
