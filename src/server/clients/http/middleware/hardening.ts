//----------------------------------------------------------------------------------------------------------------------
// Response Hardening Middleware
//----------------------------------------------------------------------------------------------------------------------

import type { MiddlewareHandler } from 'hono';

// Routes
import { APP_CONTENT_SECURITY_POLICY } from '../utils/contentSecurityPolicy.ts';

//----------------------------------------------------------------------------------------------------------------------

// Every response, because the browser guessing a content type is never something this server wants. An upload is
// served back under the type it was stored with; a browser that sniffs past that can decide a file is a document on
// evidence the uploader controls. The app policy is a default rather than an override: a response that already
// declared one -- uploaded bytes under `sandbox`, the reference UI under its nonce -- keeps what it set, and setting
// unconditionally here would strip the sandbox off every hotlink.
export function createResponseHardening() : MiddlewareHandler
{
    return async (ctx, next) =>
    {
        await next();
        ctx.header('x-content-type-options', 'nosniff');

        if(!ctx.res.headers.has('content-security-policy'))
        {
            ctx.header('content-security-policy', APP_CONTENT_SECURITY_POLICY);
        }
    };
}

//----------------------------------------------------------------------------------------------------------------------
