//----------------------------------------------------------------------------------------------------------------------
// API Body Limit Middleware
//
// Every JSON body, refused by length before anything reads it. The byte routes are exempt: their bodies are the product
// rather than a description of it.
//
// So are the methods this API never reads a body from, and that exemption is doing more than saving a measurement. The
// limiter weighs a body by draining it and then rebuilds the request around what it drained -- and the rebuild is what
// a body-less request cannot survive on every server this app runs on: under the Vite dev server an incoming DELETE
// carries an empty stream rather than a null body, so the limiter reaches the rebuild and `new Request(...)` refuses
// the wrapper it is handed. Every DELETE in the API answered 500 there. Nothing is given up by skipping them: no GET,
// HEAD, DELETE or OPTIONS route here reads a body, so an unread one is never accumulated by anything this cap could
// protect.
//----------------------------------------------------------------------------------------------------------------------

import type { MiddlewareHandler } from 'hono';
import { bodyLimit } from 'hono/body-limit';

// Models
import { API_BODY_MAX_BYTES, PayloadTooLargeError } from '@fileshed/core';

//----------------------------------------------------------------------------------------------------------------------

// The routes that carry bytes rather than a DTO. Each has a ceiling of its own -- an upload is bounded by its
// ticket's claimed size and the instance cap, an avatar and a logo by AVATAR_MAX_BYTES as they stream.
const BYTE_ROUTE_PREFIXES = [ '/api/uploads/', '/api/me/avatar', '/api/admin/branding/logo' ];

// The methods no route in this API reads a body from. HTTP permits a body on a DELETE; nothing here looks at one.
const BODILESS_METHODS = new Set([ 'GET', 'HEAD', 'DELETE', 'OPTIONS' ]);

//----------------------------------------------------------------------------------------------------------------------

// Which requests the body cap weighs. Exported because the rule is the point rather than the middleware around it:
// what it exempts decides both whether an oversized upload is refused and whether a DELETE reaches its route at all.
export function bodyLimitApplies(method : string, pathname : string) : boolean
{
    if(BYTE_ROUTE_PREFIXES.some((prefix) => pathname.startsWith(prefix))) { return false; }

    return !BODILESS_METHODS.has(method.toUpperCase());
}

export function createBodyLimit() : MiddlewareHandler
{
    const limit = bodyLimit({
        maxSize: API_BODY_MAX_BYTES,
        onError: () =>
        {
            throw new PayloadTooLargeError('The request body is too large.', API_BODY_MAX_BYTES);
        },
    });

    return async (ctx, next) =>
    {
        if(!bodyLimitApplies(ctx.req.method, new URL(ctx.req.url).pathname)) { return next(); }

        return limit(ctx, next);
    };
}

//----------------------------------------------------------------------------------------------------------------------
