//----------------------------------------------------------------------------------------------------------------------
// Rate Limit Engine — client identity, tiers, and the window
//----------------------------------------------------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';

// Engines
import { type Bucket, consume, resolveClientAddress, tierFor } from '@server/engines/rateLimit.ts';

// Utils
import { TrustedProxies } from '@server/utils/ip.ts';

//----------------------------------------------------------------------------------------------------------------------

const noProxies = new TrustedProxies([]);
const oneProxy = new TrustedProxies([ '10.0.0.0/24' ]);

//----------------------------------------------------------------------------------------------------------------------

describe('resolveClientAddress', () =>
{
    it('identifies a client by the socket it connected on', () =>
    {
        const address = resolveClientAddress({
            socketAddress: '203.0.113.9',
            forwardedFor: null,
            proxies: noProxies,
        });

        expect(address).toBe('203.0.113.9');
    });

    it('ignores a forwarded header when no proxy is trusted', () =>
    {
        const address = resolveClientAddress({
            socketAddress: '203.0.113.9',
            forwardedFor: '198.51.100.4',
            proxies: noProxies,
        });

        expect(address).toBe('203.0.113.9');
    });

    it('ignores a forwarded header from a peer that is not a trusted proxy', () =>
    {
        const address = resolveClientAddress({
            socketAddress: '203.0.113.9',
            forwardedFor: '198.51.100.4, 10.0.0.7',
            proxies: oneProxy,
        });

        expect(address).toBe('203.0.113.9');
    });

    it('takes the client from a chain a trusted proxy appended to', () =>
    {
        const address = resolveClientAddress({
            socketAddress: '10.0.0.7',
            forwardedFor: '198.51.100.4, 10.0.0.7',
            proxies: oneProxy,
        });

        expect(address).toBe('198.51.100.4');
    });

    it('stops at the first hop a trusted proxy did not add', () =>
    {
        // Two of ours in the chain, and before them an address a client wrote itself. Trusting the leftmost entry
        // would take the forgery; walking from the right takes the one our own proxy observed.
        const address = resolveClientAddress({
            socketAddress: '10.0.0.7',
            forwardedFor: '192.0.2.99, 198.51.100.4, 10.0.0.9, 10.0.0.7',
            proxies: oneProxy,
        });

        expect(address).toBe('198.51.100.4');
    });

    it('falls back to the proxy when the whole chain is our own', () =>
    {
        const address = resolveClientAddress({
            socketAddress: '10.0.0.7',
            forwardedFor: '10.0.0.9, 10.0.0.7',
            proxies: oneProxy,
        });

        expect(address).toBe('10.0.0.7');
    });

    it('falls back to the proxy when a hop in the chain is not an address at all', () =>
    {
        const address = resolveClientAddress({
            socketAddress: '10.0.0.7',
            forwardedFor: 'unknown, 10.0.0.7',
            proxies: oneProxy,
        });

        expect(address).toBe('10.0.0.7');
    });

    it('reports no client when the connection has no address', () =>
    {
        const address = resolveClientAddress({ socketAddress: null, forwardedFor: '198.51.100.4', proxies: oneProxy });

        expect(address).toBeNull();
    });

    it('reads an IPv4-mapped socket peer as the IPv4 client it is', () =>
    {
        const address = resolveClientAddress({
            socketAddress: '::ffff:203.0.113.9',
            forwardedFor: null,
            proxies: noProxies,
        });

        expect(address).toBe('203.0.113.9');
    });
});

//----------------------------------------------------------------------------------------------------------------------

describe('tierFor', () =>
{
    it('charges sign-in, sign-up, and password reset to the credential budget', () =>
    {
        expect(tierFor('/api/auth/sign-in/email')).toBe('credentials');
        expect(tierFor('/api/auth/sign-up/email')).toBe('credentials');
        expect(tierFor('/api/auth/forget-password')).toBe('credentials');
        expect(tierFor('/api/auth/reset-password')).toBe('credentials');
    });

    it('charges the first-run setup route to the credential budget', () =>
    {
        expect(tierFor('/api/setup')).toBe('credentials');
    });

    it('leaves session reads on the general budget', () =>
    {
        expect(tierFor('/api/auth/get-session')).toBe('api');
        expect(tierFor('/api/auth/sign-out')).toBe('api');
    });

    it('charges anonymous link reads to their own budget', () =>
    {
        expect(tierFor('/d/abc123')).toBe('anonymous');
    });

    it('charges the rest of the API to the general budget', () =>
    {
        expect(tierFor('/api/nodes')).toBe('api');
        expect(tierFor('/api/search')).toBe('api');
        expect(tierFor('/api/blobs/claim')).toBe('api');
    });

    it('budgets nothing for the client the server serves', () =>
    {
        expect(tierFor('/')).toBeNull();
        expect(tierFor('/assets/index-abc123.js')).toBeNull();
    });

    it('cannot be stepped around by spelling the path differently', () =>
    {
        expect(tierFor('/api/auth//sign-in/email')).toBe('credentials');
        expect(tierFor('/api/auth/SIGN-IN/email')).toBe('credentials');
        expect(tierFor('/api/auth%2Fsign-in/email')).toBe('credentials');
    });
});

//----------------------------------------------------------------------------------------------------------------------

describe('consume', () =>
{
    const rule = { windowSeconds: 60, max: 3 };
    const START = 1_000_000;

    it('opens a window on the first request', () =>
    {
        const decision = consume(undefined, rule, START);

        expect(decision.allowed).toBe(true);
        expect(decision.bucket).toEqual({ count: 1, startedAt: START });
    });

    it('allows exactly the budgeted number of requests inside one window', () =>
    {
        let bucket : Bucket | undefined;
        const allowed : boolean[] = [];

        for(let attempt = 0; attempt < 5; attempt += 1)
        {
            const decision = consume(bucket, rule, START + attempt);
            allowed.push(decision.allowed);
            bucket = decision.bucket;
        }

        expect(allowed).toEqual([ true, true, true, false, false ]);
    });

    it('starts a fresh window once the old one has run out', () =>
    {
        const spent : Bucket = { count: 3, startedAt: START };

        const decision = consume(spent, rule, START + 60_000);

        expect(decision.allowed).toBe(true);
        expect(decision.bucket).toEqual({ count: 1, startedAt: START + 60_000 });
    });

    it('reports how long a refused client has to wait', () =>
    {
        const spent : Bucket = { count: 3, startedAt: START };

        const decision = consume(spent, rule, START + 20_000);

        expect(decision.retryAfterSeconds).toBe(40);
    });

    it('never tells a refused client to retry immediately', () =>
    {
        const spent : Bucket = { count: 3, startedAt: START };

        const decision = consume(spent, rule, START + 59_999);

        expect(decision.retryAfterSeconds).toBe(1);
    });

    it('leaves the spent bucket untouched on a refusal, so a flood cannot extend its own window', () =>
    {
        const spent : Bucket = { count: 3, startedAt: START };

        const decision = consume(spent, rule, START + 20_000);

        expect(decision.bucket).toEqual(spent);
    });
});

//----------------------------------------------------------------------------------------------------------------------
