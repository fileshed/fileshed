//----------------------------------------------------------------------------------------------------------------------
// Config — social provider env pairs
//
// loadConfig parses process.env, so these drive it through the real environment (each provider key saved and restored
// around the run). The contract under test: a social provider activates only when BOTH halves of its env pair are
// present -- one half without the other is a boot-time misconfiguration that fails the parse, exactly like the admin
// email/password pair.
//----------------------------------------------------------------------------------------------------------------------

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

// Utils
import { loadConfig } from '@server/utils/config.ts';

//----------------------------------------------------------------------------------------------------------------------

const MANAGED_KEYS = [
    'AUTH_SECRET',
    'BASE_URL',
    'GITHUB_CLIENT_ID',
    'GITHUB_CLIENT_SECRET',
    'GOOGLE_CLIENT_ID',
    'GOOGLE_CLIENT_SECRET',
] as const;

const saved : Record<string, string | undefined> = {};

// Start each case from a clean, minimally valid environment: the required AUTH_SECRET present, every provider key
// absent, and BASE_URL cleared so its default applies (the Vitest/Vite process leaks BASE_URL='/', which the URL
// schema would reject). A case sets only the provider halves it is exercising.
beforeEach(() =>
{
    for(const key of MANAGED_KEYS)
    {
        saved[key] = process.env[key];
        Reflect.deleteProperty(process.env, key);
    }

    process.env['AUTH_SECRET'] = 'test-auth-secret-test-auth-secret-test';
});

afterEach(() =>
{
    for(const key of MANAGED_KEYS)
    {
        const original = saved[key];
        if(original === undefined) { Reflect.deleteProperty(process.env, key); }
        else { process.env[key] = original; }
    }
});

//----------------------------------------------------------------------------------------------------------------------

describe('loadConfig social provider validation', () =>
{
    it('accepts github when both client id and secret are set', () =>
    {
        process.env['GITHUB_CLIENT_ID'] = 'gh-id';
        process.env['GITHUB_CLIENT_SECRET'] = 'gh-secret';

        const config = loadConfig();

        expect(config.GITHUB_CLIENT_ID).toBe('gh-id');
        expect(config.GITHUB_CLIENT_SECRET).toBe('gh-secret');
    });

    it('rejects a github client id set without its secret', () =>
    {
        process.env['GITHUB_CLIENT_ID'] = 'gh-id';

        expect(() => loadConfig()).toThrow(/GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET/);
    });

    it('rejects a github client secret set without its id', () =>
    {
        process.env['GITHUB_CLIENT_SECRET'] = 'gh-secret';

        expect(() => loadConfig()).toThrow(/GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET/);
    });

    it('accepts an environment with no github vars at all', () =>
    {
        const config = loadConfig();

        expect(config.GITHUB_CLIENT_ID).toBeUndefined();
        expect(config.GITHUB_CLIENT_SECRET).toBeUndefined();
    });

    it('accepts google when both client id and secret are set', () =>
    {
        process.env['GOOGLE_CLIENT_ID'] = 'goog-id';
        process.env['GOOGLE_CLIENT_SECRET'] = 'goog-secret';

        const config = loadConfig();

        expect(config.GOOGLE_CLIENT_ID).toBe('goog-id');
        expect(config.GOOGLE_CLIENT_SECRET).toBe('goog-secret');
    });

    it('rejects a google client id set without its secret', () =>
    {
        process.env['GOOGLE_CLIENT_ID'] = 'goog-id';

        expect(() => loadConfig()).toThrow(/GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET/);
    });

    it('rejects a google client secret set without its id', () =>
    {
        process.env['GOOGLE_CLIENT_SECRET'] = 'goog-secret';

        expect(() => loadConfig()).toThrow(/GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET/);
    });
});

//----------------------------------------------------------------------------------------------------------------------
