//----------------------------------------------------------------------------------------------------------------------
// Auth Policy — the decisions better-auth would otherwise make for us
//
// Each of these is a library default that is invisible when it is right and invisible when it is wrong. Asserting the
// stated value is the point: a default that moves in a dependency bump has to break something.
//----------------------------------------------------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';

// Resource Access
import { resolveIpAddressPolicy } from '@server/resource-access/auth.ts';

// Test support
import { bootTestApp, testConfig } from './support.ts';

//----------------------------------------------------------------------------------------------------------------------

describe('createAuth', () =>
{
    it('never links an OAuth identity into an existing account on its own', async () =>
    {
        const booted = await bootTestApp();

        expect(booted.auth.options.account.accountLinking.enabled).toBe(false);

        await booted.handle.db.destroy();
    });

    it('runs no rate limiter of its own, leaving one limiter that can see the connection', async () =>
    {
        const booted = await bootTestApp();

        expect(booted.auth.options.rateLimit.enabled).toBe(false);

        await booted.handle.db.destroy();
    });

    it('carries the deployment\'s forwarded-header policy rather than the library default', async () =>
    {
        const booted = await bootTestApp({ TRUSTED_PROXIES: [ '10.0.0.0/24' ] });

        expect(booted.auth.options.advanced.ipAddress).toEqual({
            ipAddressHeaders: [ 'x-forwarded-for' ],
            trustedProxies: [ '10.0.0.0/24' ],
        });

        await booted.handle.db.destroy();
    });

    // The value this library defaults to has already moved once. What it must be for this instance is that a request
    // cannot name the host its own password-reset link is built on: better-auth reads the header without ever seeing
    // the socket it arrived over, so it has no way to tell a proxy's word from a client's.
    it('builds its URLs from the host a request was addressed to, never from a forwarded one', async () =>
    {
        const booted = await bootTestApp({ TRUSTED_PROXIES: [ '10.0.0.0/24' ] });

        expect(booted.auth.options.advanced.trustedProxyHeaders).toBe(false);

        await booted.handle.db.destroy();
    });
});

//----------------------------------------------------------------------------------------------------------------------

describe('resolveIpAddressPolicy', () =>
{
    it('believes no forwarded header when no proxy has been named', () =>
    {
        expect(resolveIpAddressPolicy(testConfig({ TRUSTED_PROXIES: null }))).toEqual({
            ipAddressHeaders: [],
            trustedProxies: [],
        });
    });

    it('believes no forwarded header when the deployment states that nothing fronts it', () =>
    {
        expect(resolveIpAddressPolicy(testConfig({ TRUSTED_PROXIES: [] }))).toEqual({
            ipAddressHeaders: [],
            trustedProxies: [],
        });
    });

    it('reads the forwarded header only against the proxies the deployment named', () =>
    {
        expect(resolveIpAddressPolicy(testConfig({ TRUSTED_PROXIES: [ '10.0.0.7', '2001:db8::/32' ] }))).toEqual({
            ipAddressHeaders: [ 'x-forwarded-for' ],
            trustedProxies: [ '10.0.0.7', '2001:db8::/32' ],
        });
    });
});

//----------------------------------------------------------------------------------------------------------------------
