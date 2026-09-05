//----------------------------------------------------------------------------------------------------------------------
// Origin Check Middleware
//
// Server-side CSRF defence for the mutating half of /api. SameSite=Lax on the session cookie already stops a browser
// attaching it to a cross-site POST, and while that holds this refuses nothing a real client sends. It exists so the
// cookie attribute is not the only thing standing there: a client served from another origin, or a gateway that needs
// SameSite=None, changes the cookie and leaves this in place.
//----------------------------------------------------------------------------------------------------------------------

import type { MiddlewareHandler } from 'hono';

// Engines
import { originAllowed } from '../engines/requestOrigin.ts';

// Utils
import type { Config } from '../utils/config.ts';

//----------------------------------------------------------------------------------------------------------------------

export interface OriginCheckOptions
{
    // Origins beyond the one a request was addressed to. A same-origin client needs none of these.
    allowedOrigins : readonly string[];
}

export function originCheckOptionsFromConfig(config : Config) : OriginCheckOptions
{
    return { allowedOrigins: [ config.BASE_URL, ...config.TRUSTED_ORIGINS ] };
}

export function createOriginCheck(options : OriginCheckOptions) : MiddlewareHandler
{
    return async (ctx, next) =>
    {
        const url = new URL(ctx.req.url);

        const allowed = originAllowed({
            method: ctx.req.method,
            pathname: url.pathname,
            origin: ctx.req.header('origin') ?? null,
            host: ctx.req.header('host') ?? url.host,
            allowedOrigins: options.allowedOrigins,
        });

        if(!allowed)
        {
            return ctx.json({ error: 'Cross-origin request refused.' }, 403);
        }

        return next();
    };
}

//----------------------------------------------------------------------------------------------------------------------
