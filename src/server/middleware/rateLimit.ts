//----------------------------------------------------------------------------------------------------------------------
// Rate Limit Middleware
//
// Counting is per process and in memory, which is the honest scope of it: two FileShed instances behind one load
// balancer enforce a budget each, so a client spread across both gets the sum. That is a real gap for a multi-instance
// deployment and the answer there is a shared store or a limiter at the front door -- not a claim this one is
// distributed. A single-process deployment, which is every FileShed deployment the container image produces, is
// covered exactly as written.
//----------------------------------------------------------------------------------------------------------------------

import type { Context, MiddlewareHandler } from 'hono';
import { getConnInfo } from '@hono/node-server/conninfo';

// Models
import { RATE_LIMIT_MAX_BUCKETS } from '@fileshed/core';

// Engines
import { type Bucket, type RateLimitRule, type RateLimitTier, consume, resolveClientAddress, tierFor }
    from '../engines/rateLimit.ts';

// Utils
import { TrustedProxies, bucketAddress } from '../utils/ip.ts';
import type { Config } from '../utils/config.ts';
import { getLogger } from '../utils/logger.ts';

//----------------------------------------------------------------------------------------------------------------------

const logger = getLogger('rateLimit');

export interface RateLimitOptions
{
    enabled : boolean;
    windowSeconds : number;
    max : Record<RateLimitTier, number>;
    trustedProxies : readonly string[];

    // The socket peer, overridable so a spec can drive the limiter without a real listener. Production reads it from
    // the node adapter's connection info.
    socketAddress ?: (ctx : Context) => string | null;
}

export function rateLimitOptionsFromConfig(config : Config) : RateLimitOptions
{
    return {
        enabled: config.RATE_LIMIT_ENABLED,
        windowSeconds: config.RATE_LIMIT_WINDOW_SECONDS,
        max: {
            api: config.RATE_LIMIT_MAX,
            credentials: config.RATE_LIMIT_CREDENTIALS_MAX,
            anonymous: config.RATE_LIMIT_ANONYMOUS_MAX,
        },
        trustedProxies: config.TRUSTED_PROXIES ?? [],
    };
}

//----------------------------------------------------------------------------------------------------------------------

function socketAddressFrom(ctx : Context) : string | null
{
    try
    {
        return getConnInfo(ctx).remote.address ?? null;
    }
    catch
    {
        // No node socket behind this context -- the Vite dev runtime, or a spec driving app.request directly.
        return null;
    }
}

// Expired buckets first, then the oldest live ones. Map iterates in insertion order, and a bucket is re-inserted on
// every allowed request, so the front of the map is the least recently active.
function prune(buckets : Map<string, Bucket>, windowMs : number, now : number) : void
{
    for(const [ key, bucket ] of buckets)
    {
        if(now - bucket.startedAt >= windowMs) { buckets.delete(key); }
    }

    for(const key of buckets.keys())
    {
        if(buckets.size <= RATE_LIMIT_MAX_BUCKETS) { break; }
        buckets.delete(key);
    }
}

//----------------------------------------------------------------------------------------------------------------------

export function createRateLimit(options : RateLimitOptions) : MiddlewareHandler
{
    const proxies = new TrustedProxies(options.trustedProxies);
    const readSocketAddress = options.socketAddress ?? socketAddressFrom;
    const buckets = new Map<string, Bucket>();
    const windowMs = options.windowSeconds * 1000;

    let unidentifiedWarned = false;

    return async (ctx, next) =>
    {
        if(!options.enabled) { return next(); }

        const tier = tierFor(new URL(ctx.req.url).pathname);
        if(tier === null) { return next(); }

        const address = resolveClientAddress({
            socketAddress: readSocketAddress(ctx),
            forwardedFor: ctx.req.header('x-forwarded-for') ?? null,
            proxies,
        });

        // No socket peer to key on. Counting every such request together would hand any client a way to exhaust one
        // bucket and lock out the instance, which is worse than not counting, so these pass -- said once, loudly,
        // because in a deployment served by the node adapter it never happens.
        if(address === null)
        {
            if(!unidentifiedWarned)
            {
                logger.warn('Rate limiting is passing requests through: no client address is available from the '
                    + 'connection. Requests are not being counted.');
                unidentifiedWarned = true;
            }

            return next();
        }

        const now = Date.now();
        const key = `${ tier }|${ bucketAddress(address) }`;
        const rule : RateLimitRule = { windowSeconds: options.windowSeconds, max: options.max[tier] };
        const decision = consume(buckets.get(key), rule, now);

        if(!decision.allowed)
        {
            return ctx.json(
                { error: 'Too many requests. Slow down and try again shortly.' },
                429,
                { 'retry-after': String(decision.retryAfterSeconds) }
            );
        }

        buckets.delete(key);
        buckets.set(key, decision.bucket);

        if(buckets.size > RATE_LIMIT_MAX_BUCKETS) { prune(buckets, windowMs, now); }

        return next();
    };
}

//----------------------------------------------------------------------------------------------------------------------
