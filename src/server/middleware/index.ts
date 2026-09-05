//----------------------------------------------------------------------------------------------------------------------
// Security Middleware
//
// Order matters: the budget check is the cheaper refusal and runs first, so a flood is turned away before anything
// parses a URL for it.
//----------------------------------------------------------------------------------------------------------------------

import type { MiddlewareHandler } from 'hono';

// Utils
import type { Config } from '../utils/config.ts';

// Middleware
import { createOriginCheck, originCheckOptionsFromConfig } from './originCheck.ts';
import { createRateLimit, rateLimitOptionsFromConfig } from './rateLimit.ts';

//----------------------------------------------------------------------------------------------------------------------

export { type OriginCheckOptions, createOriginCheck, originCheckOptionsFromConfig } from './originCheck.ts';
export { type RateLimitOptions, createRateLimit, rateLimitOptionsFromConfig } from './rateLimit.ts';

//----------------------------------------------------------------------------------------------------------------------

export function securityMiddleware(config : Config) : MiddlewareHandler[]
{
    return [
        createRateLimit(rateLimitOptionsFromConfig(config)),
        createOriginCheck(originCheckOptionsFromConfig(config)),
    ];
}

//----------------------------------------------------------------------------------------------------------------------
