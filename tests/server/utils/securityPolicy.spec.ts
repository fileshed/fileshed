//----------------------------------------------------------------------------------------------------------------------
// Security Policy Warnings — what a production boot says out loud
//----------------------------------------------------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';

// Utils
import type { Config } from '@server/utils/config.ts';
import { securityWarnings } from '@server/utils/securityPolicy.ts';

// Test support
import { testConfig } from '../auth/support.ts';

//----------------------------------------------------------------------------------------------------------------------

const PRODUCTION = { NODE_ENV: 'production' };

// The deployment with nothing left undecided: https, a stated proxy policy, limits on.
function settled(overrides : Partial<Config> = {}) : Config
{
    return testConfig({
        BASE_URL: 'https://files.example.com',
        TRUSTED_PROXIES: [],
        RATE_LIMIT_ENABLED: true,
        ...overrides,
    });
}

function codes(config : Config, env : Record<string, string | undefined> = PRODUCTION) : string[]
{
    return securityWarnings(config, env).map((warning) => warning.code);
}

//----------------------------------------------------------------------------------------------------------------------

describe('securityWarnings', () =>
{
    it('says nothing when every decision has been made', () =>
    {
        expect(codes(settled())).toEqual([]);
    });

    it('warns that an http instance ships session cookies a browser will send in the clear', () =>
    {
        expect(codes(settled({ BASE_URL: 'http://files.example.com' }))).toContain('insecure-cookies');
    });

    it('names the override in the cookie warning, so the message carries its own fix', () =>
    {
        const [ warning ] = securityWarnings(settled({ BASE_URL: 'http://files.example.com' }), PRODUCTION);

        expect(warning?.message).toContain('ALLOW_INSECURE_COOKIES');
    });

    it('stops warning about http once an operator has said they mean it', () =>
    {
        const config = settled({ BASE_URL: 'http://files.example.com', ALLOW_INSECURE_COOKIES: true });

        expect(codes(config)).toEqual([]);
    });

    it('warns when no decision has been made about which proxies to believe', () =>
    {
        expect(codes(settled({ TRUSTED_PROXIES: null }))).toContain('undecided-proxy-trust');
    });

    it('accepts an explicit "no proxy fronts this" as a decision', () =>
    {
        expect(codes(settled({ TRUSTED_PROXIES: [] }))).toEqual([]);
    });

    it('accepts a named proxy as a decision', () =>
    {
        expect(codes(settled({ TRUSTED_PROXIES: [ '10.0.0.0/24' ] }))).toEqual([]);
    });

    it('warns when request budgets have been switched off', () =>
    {
        expect(codes(settled({ RATE_LIMIT_ENABLED: false }))).toContain('rate-limiting-off');
    });

    it('stays quiet outside production about the settings that only describe a deployment', () =>
    {
        const undecided = settled({ BASE_URL: 'http://localhost:5173', TRUSTED_PROXIES: null });

        expect(securityWarnings(undecided, { NODE_ENV: undefined })).toEqual([]);
        expect(securityWarnings(undecided, { NODE_ENV: 'development' })).toEqual([]);
    });

    it('warns that every Host header is believed, whatever the instance is built for', () =>
    {
        const open = settled({ ALLOWED_HOSTS: [ '*' ] });

        expect(codes(open)).toContain('any-host');
        expect(codes(open, { NODE_ENV: 'development' })).toContain('any-host');
    });

    it('warns that every origin may write, whatever the instance is built for', () =>
    {
        const open = settled({ TRUSTED_ORIGINS: [ '*' ] });

        expect(codes(open)).toContain('any-origin');
        expect(codes(open, { NODE_ENV: 'development' })).toContain('any-origin');
    });

    // Naming hosts and origins is the ordinary multi-URL deployment, not a posture to warn about.
    it('says nothing about a named list of hosts or origins', () =>
    {
        const named = settled({
            ALLOWED_HOSTS: [ 'files.internal:3950' ],
            TRUSTED_ORIGINS: [ 'https://files.internal:3950' ],
        });

        expect(codes(named)).toEqual([]);
    });
});

//----------------------------------------------------------------------------------------------------------------------
