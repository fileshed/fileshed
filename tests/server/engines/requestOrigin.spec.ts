//----------------------------------------------------------------------------------------------------------------------
// Request Origin Engine — what a mutating API request may claim about where it came from
//----------------------------------------------------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';

// Engines
import { originAllowed } from '@server/engines/requestOrigin.ts';

//----------------------------------------------------------------------------------------------------------------------

const HOST = 'files.example.com';

function check(overrides : Partial<Parameters<typeof originAllowed>[0]> = {}) : boolean
{
    return originAllowed({
        method: 'POST',
        pathname: '/api/nodes',
        origin: `https://${ HOST }`,
        host: HOST,
        allowedOrigins: [],
        ...overrides,
    });
}

//----------------------------------------------------------------------------------------------------------------------

describe('originAllowed', () =>
{
    it('allows a request the browser made from the page this instance serves', () =>
    {
        expect(check()).toBe(true);
    });

    it('refuses a mutating request a browser made from somewhere else', () =>
    {
        expect(check({ origin: 'https://evil.example' })).toBe(false);
    });

    it('refuses every mutating method, not just POST', () =>
    {
        for(const method of [ 'POST', 'PUT', 'PATCH', 'DELETE' ])
        {
            expect(check({ method, origin: 'https://evil.example' })).toBe(false);
        }
    });

    it('leaves reads alone, since a browser cannot be made to change state with one', () =>
    {
        expect(check({ method: 'GET', origin: 'https://evil.example' })).toBe(true);
        expect(check({ method: 'HEAD', origin: 'https://evil.example' })).toBe(true);
    });

    it('leaves everything outside the API alone', () =>
    {
        expect(check({ pathname: '/d/token', origin: 'https://evil.example' })).toBe(true);
        expect(check({ pathname: '/index.html', origin: 'https://evil.example' })).toBe(true);
    });

    it('allows a request carrying no origin at all, which is what a CLI or gateway sends', () =>
    {
        expect(check({ origin: null })).toBe(true);
    });

    it('allows a browser client served from a configured alternate origin', () =>
    {
        expect(check({
            origin: 'https://app.example.com',
            allowedOrigins: [ 'https://files.example.com', 'https://app.example.com' ],
        })).toBe(true);
    });

    it('accepts the request host over http while the browser speaks https, as a TLS-terminating proxy produces', () =>
    {
        expect(check({ origin: `https://${ HOST }`, host: HOST, allowedOrigins: [ `http://${ HOST }` ] })).toBe(true);
    });

    it('refuses an origin a page cannot legitimately have', () =>
    {
        expect(check({ origin: 'null' })).toBe(false);
        expect(check({ origin: 'file://' })).toBe(false);
    });

    it('does not let a lookalike host pass for the real one', () =>
    {
        expect(check({ origin: `https://${ HOST }.evil.example` })).toBe(false);
        expect(check({ origin: `https://evil.example#${ HOST }` })).toBe(false);
    });
});

//----------------------------------------------------------------------------------------------------------------------
