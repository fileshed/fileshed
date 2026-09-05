//----------------------------------------------------------------------------------------------------------------------
// Rate Limit Engine
//
// Two decisions, both pure: which client a request is from, and whether that client has spent its budget.
//
// The first is the one that matters. An address a client can choose for itself is not a client identifier -- it is a
// field in the request, and a limiter keyed on it counts to three and then starts over. So the socket's peer is the
// answer, and a forwarded chain is read only when the peer is a proxy the deployment named, right to left, down to
// the first hop that proxy did not add.
//----------------------------------------------------------------------------------------------------------------------

// Utils
import { type TrustedProxies, normalizeAddress } from '../utils/ip.ts';

//----------------------------------------------------------------------------------------------------------------------
// Client address
//----------------------------------------------------------------------------------------------------------------------

export interface ClientAddressInput
{
    // The peer of the TCP connection this request arrived on.
    socketAddress : string | null;

    // The raw X-Forwarded-For header, believed only when the socket peer is a trusted proxy.
    forwardedFor : string | null;

    proxies : TrustedProxies;
}

export function resolveClientAddress(input : ClientAddressInput) : string | null
{
    const socket = normalizeAddress(input.socketAddress);

    // Nothing behind us is trusted, or the connection did not come from something that is: the peer is the client,
    // and whatever it claims about earlier hops is its own invention.
    if(!input.proxies.trusts(socket)) { return socket; }

    const chain = (input.forwardedFor ?? '').split(',')
        .map((hop) => normalizeAddress(hop));

    // Right to left: each trusted hop was appended by a proxy we run, so keep walking. The first address that is not
    // one of ours is the furthest point we have evidence for. A chain that is trusted all the way down means the
    // request originated inside the proxy tier, so the peer stands.
    for(let index = chain.length - 1; index >= 0; index -= 1)
    {
        const hop = chain[index] ?? null;
        if(hop === null) { return socket; }
        if(!input.proxies.trusts(hop)) { return hop; }
    }

    return socket;
}

//----------------------------------------------------------------------------------------------------------------------
// Tiers
//----------------------------------------------------------------------------------------------------------------------

// What a request costs against, or null for the ones that are not budgeted at all -- the built client's own assets,
// which are static bytes and whose 429 would be a blank page.
export type RateLimitTier = 'credentials' | 'anonymous' | 'api';

// The auth endpoints that spend a credential or issue one, as prefixes. Deliberately a superset of the routes
// better-auth exposes today: an endpoint that lands here later starts out throttled rather than starts out open.
// Everything else under /api/auth (get-session above all, which every page load asks for) is ordinary API traffic.
const credentialPrefixes = [
    '/api/auth/sign-in',
    '/api/auth/sign-up',
    '/api/auth/callback',
    '/api/auth/forget-password',
    '/api/auth/request-password-reset',
    '/api/auth/reset-password',
    '/api/auth/change-password',
    '/api/auth/change-email',
    '/api/auth/verify-email',
    '/api/auth/send-verification-email',
    '/api/auth/two-factor',
    '/api/setup',
];

const anonymousPrefixes = [ '/d' ];

const apiPrefixes = [ '/api' ];

// Matched against the same adversarial normalization the auth gate uses: percent-decoded so an encoded slash cannot
// hide a segment, collapsed on repeated slashes, lowercased. A tier that can be stepped around by spelling is not a
// tier.
function normalizePath(pathname : string) : string
{
    let path = pathname;
    try { path = decodeURIComponent(pathname); }
    catch { /* malformed encoding: the raw path routes to a 404 anyway, so budget it as it stands */ }

    return path.replace(/\/{2,}/g, '/').toLowerCase();
}

function matches(path : string, prefixes : readonly string[]) : boolean
{
    return prefixes.some((prefix) => path === prefix || path.startsWith(`${ prefix }/`));
}

export function tierFor(pathname : string) : RateLimitTier | null
{
    const path = normalizePath(pathname);

    if(matches(path, credentialPrefixes)) { return 'credentials'; }
    if(matches(path, anonymousPrefixes)) { return 'anonymous'; }
    if(matches(path, apiPrefixes)) { return 'api'; }

    return null;
}

//----------------------------------------------------------------------------------------------------------------------
// Budget
//----------------------------------------------------------------------------------------------------------------------

export interface RateLimitRule
{
    windowSeconds : number;
    max : number;
}

export interface Bucket
{
    count : number;
    startedAt : number;
}

export interface RateLimitDecision
{
    allowed : boolean;

    // Seconds until the window this bucket is in expires; 0 when the request was allowed.
    retryAfterSeconds : number;

    bucket : Bucket;
}

// A fixed window rather than a rolling one: the whole count is a number and a timestamp, which is what keeps a bucket
// small enough that a hundred thousand of them fit in memory. The cost is a burst of up to 2x max across a window
// boundary, which does not matter for a ceiling on abuse.
export function consume(bucket : Bucket | undefined, rule : RateLimitRule, now : number) : RateLimitDecision
{
    const windowMs = rule.windowSeconds * 1000;

    if(bucket === undefined || now - bucket.startedAt >= windowMs)
    {
        return { allowed: true, retryAfterSeconds: 0, bucket: { count: 1, startedAt: now } };
    }

    if(bucket.count >= rule.max)
    {
        const remainingMs = bucket.startedAt + windowMs - now;

        return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil(remainingMs / 1000)), bucket };
    }

    return { allowed: true, retryAfterSeconds: 0, bucket: { count: bucket.count + 1, startedAt: bucket.startedAt } };
}

//----------------------------------------------------------------------------------------------------------------------
