//----------------------------------------------------------------------------------------------------------------------
// IP Addresses — normalization, proxy membership, and bucket keys
//----------------------------------------------------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';

// Utils
import { TrustedProxies, bucketAddress, normalizeAddress, parseProxyEntry } from '@server/utils/ip.ts';

//----------------------------------------------------------------------------------------------------------------------

describe('normalizeAddress', () =>
{
    it('unwraps an IPv4-mapped address to the IPv4 it carries', () =>
    {
        expect(normalizeAddress('::ffff:203.0.113.9')).toBe('203.0.113.9');
    });

    it('drops the zone index a link-local address carries', () =>
    {
        expect(normalizeAddress('fe80::1%eth0')).toBe('fe80::1');
    });

    it('spells one address one way, so a client cannot key two buckets', () =>
    {
        expect(normalizeAddress('2001:DB8::1')).toBe('2001:db8::1');
    });

    it('reports no address for text that is not one', () =>
    {
        expect(normalizeAddress('unknown')).toBeNull();
        expect(normalizeAddress('203.0.113.9:8080')).toBeNull();
        expect(normalizeAddress('')).toBeNull();
        expect(normalizeAddress(null)).toBeNull();
    });
});

//----------------------------------------------------------------------------------------------------------------------

describe('parseProxyEntry', () =>
{
    it('reads a bare address as a range covering only itself', () =>
    {
        expect(parseProxyEntry('10.0.0.7')).toEqual({ address: '10.0.0.7', prefix: 32, family: 'ipv4' });
        expect(parseProxyEntry('2001:db8::1')).toEqual({ address: '2001:db8::1', prefix: 128, family: 'ipv6' });
    });

    it('reads a CIDR range', () =>
    {
        expect(parseProxyEntry('10.0.0.0/24')).toEqual({ address: '10.0.0.0', prefix: 24, family: 'ipv4' });
    });

    it('rejects a prefix wider than the family allows', () =>
    {
        expect(parseProxyEntry('10.0.0.0/33')).toBeNull();
        expect(parseProxyEntry('2001:db8::/129')).toBeNull();
    });

    it('rejects text that is not an address or a range', () =>
    {
        expect(parseProxyEntry('proxy.example.com')).toBeNull();
        expect(parseProxyEntry('10.0.0.0/')).toBeNull();
        expect(parseProxyEntry('10.0.0.0/24/8')).toBeNull();
    });
});

//----------------------------------------------------------------------------------------------------------------------

describe('TrustedProxies', () =>
{
    it('trusts nothing when nothing was named', () =>
    {
        const proxies = new TrustedProxies([]);

        expect(proxies.isEmpty).toBe(true);
        expect(proxies.trusts('10.0.0.7')).toBe(false);
    });

    it('trusts an address inside a named range and nothing outside it', () =>
    {
        const proxies = new TrustedProxies([ '10.0.0.0/24' ]);

        expect(proxies.trusts('10.0.0.7')).toBe(true);
        expect(proxies.trusts('10.0.1.7')).toBe(false);
    });

    it('trusts an address named on its own', () =>
    {
        const proxies = new TrustedProxies([ '192.0.2.10' ]);

        expect(proxies.trusts('192.0.2.10')).toBe(true);
        expect(proxies.trusts('192.0.2.11')).toBe(false);
    });

    it('keeps the families apart', () =>
    {
        const proxies = new TrustedProxies([ '2001:db8::/32' ]);

        expect(proxies.trusts('2001:db8::7')).toBe(true);
        expect(proxies.trusts('10.0.0.7')).toBe(false);
    });

    it('trusts nothing on the strength of an unparseable entry', () =>
    {
        const proxies = new TrustedProxies([ 'proxy.example.com' ]);

        expect(proxies.isEmpty).toBe(true);
        expect(proxies.trusts('10.0.0.7')).toBe(false);
    });
});

//----------------------------------------------------------------------------------------------------------------------

describe('bucketAddress', () =>
{
    it('keys an IPv4 client by its own address', () =>
    {
        expect(bucketAddress('203.0.113.9')).toBe('203.0.113.9');
    });

    it('keys every address in one IPv6 /64 to the same bucket', () =>
    {
        // The block a residential IPv6 client is handed whole. Keying the full address would let it rotate freely.
        const first = bucketAddress('2001:db8:1:2::1');
        const second = bucketAddress('2001:db8:1:2:ffff:ffff:ffff:ffff');

        expect(second).toBe(first);
    });

    it('keeps separate IPv6 /64s in separate buckets', () =>
    {
        expect(bucketAddress('2001:db8:1:2::1')).not.toBe(bucketAddress('2001:db8:1:3::1'));
    });
});

//----------------------------------------------------------------------------------------------------------------------
