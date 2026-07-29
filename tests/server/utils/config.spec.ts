//----------------------------------------------------------------------------------------------------------------------
// Config — the yaml-substitution layer and its validations
//
// loadConfig reads the committed config.yaml with ${VAR}/${VAR:-fallback} substitution against the real
// environment (each managed key saved and restored around the run), so these specs prove that environment
// variables genuinely flow THROUGH the file into the validated config. The contracts under test: substitution
// semantics, the AUTH_SECRET placeholder rejection, and the provider env overlay -- any provider credential in
// the environment reaches the config by its setting name without a yaml line, and a partial pair loads fine
// (whether it activates is boot's judgement, not the loader's).
//----------------------------------------------------------------------------------------------------------------------

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

// Utils
import { loadConfig, substituteEnv } from '@server/utils/config.ts';

//----------------------------------------------------------------------------------------------------------------------

const MANAGED_KEYS = [
    'AUTH_SECRET',
    'BASE_URL',
    'GITHUB_CLIENT_ID',
    'GITHUB_CLIENT_SECRET',
    'GITLAB_CLIENT_ID',
    'GITLAB_CLIENT_SECRET',
    'GITLAB_ISSUER',
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

describe('substituteEnv', () =>
{
    // The contract: a set, non-empty environment variable wins; the ${VAR:-fallback} fallback covers unset AND
    // empty (matching shell semantics); ${VAR} with nothing behind it substitutes to empty, which the loader then
    // reads as unset. Substitution happens on raw text, so numeric fallbacks become real yaml numbers downstream.
    it('prefers the environment, falls back per-variable, and empties bare misses', () =>
    {
        const text = 'a: ${ALPHA:-default-a}\nb: ${BRAVO:-3000}\nc: ${CHARLIE}';

        expect(substituteEnv(text, { ALPHA: 'from-env' })).toBe('a: from-env\nb: 3000\nc: ');
        expect(substituteEnv(text, { ALPHA: '', BRAVO: '4000', CHARLIE: 'set' }))
            .toBe('a: default-a\nb: 4000\nc: set');
    });
});

//----------------------------------------------------------------------------------------------------------------------

describe('loadConfig AUTH_SECRET validation', () =>
{
    // The sample placeholder is long enough to pass the length floor on purpose (so length is tested separately),
    // which is exactly why it must be rejected by name: a secret published in the repo signs forgeable sessions.
    it('rejects the sample placeholder even though it satisfies the length requirement', () =>
    {
        process.env['AUTH_SECRET'] = 'CHANGE_ME_this_is_a_placeholder_not_a_real_secret';

        expect(() => loadConfig()).toThrow(/placeholder/);
    });

    it('rejects a secret under 32 characters', () =>
    {
        process.env['AUTH_SECRET'] = 'too-short';

        expect(() => loadConfig()).toThrow(/32 characters/);
    });
});

//----------------------------------------------------------------------------------------------------------------------

describe('loadConfig provider env overlay', () =>
{
    it('carries a provider env pair into the config without a yaml line', () =>
    {
        process.env['GITHUB_CLIENT_ID'] = 'gh-id';
        process.env['GITHUB_CLIENT_SECRET'] = 'gh-secret';

        const config = loadConfig();

        expect(config.GITHUB_CLIENT_ID).toBe('gh-id');
        expect(config.GITHUB_CLIENT_SECRET).toBe('gh-secret');
    });

    it('works for any provider on the list, extras included -- nothing is special-cased to github', () =>
    {
        process.env['GITLAB_CLIENT_ID'] = 'gl-id';
        process.env['GITLAB_CLIENT_SECRET'] = 'gl-secret';
        process.env['GITLAB_ISSUER'] = 'https://gitlab.example.com';

        const config = loadConfig();

        expect(config.GITLAB_CLIENT_ID).toBe('gl-id');
        expect(config.GITLAB_CLIENT_SECRET).toBe('gl-secret');
        expect(config.GITLAB_ISSUER).toBe('https://gitlab.example.com');
    });

    it('loads a partial pair without failing -- activation is judged at boot, not here', () =>
    {
        process.env['GITHUB_CLIENT_ID'] = 'gh-id';

        const config = loadConfig();

        expect(config.GITHUB_CLIENT_ID).toBe('gh-id');
        expect(config.GITHUB_CLIENT_SECRET).toBeUndefined();
    });

    it('leaves every provider key unset with a clean environment', () =>
    {
        const config = loadConfig();

        expect(config.GITHUB_CLIENT_ID).toBeUndefined();
        expect(config.GITLAB_CLIENT_ID).toBeUndefined();
    });
});

//----------------------------------------------------------------------------------------------------------------------
