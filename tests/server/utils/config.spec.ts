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

// Models
import { DEFAULT_UPLOAD_CHUNK_BYTES, MIN_UPLOAD_CHUNK_BYTES } from '@fileshed/core';

// Utils
import { loadConfig, substituteEnv } from '@server/utils/config.ts';

//----------------------------------------------------------------------------------------------------------------------

const MANAGED_KEYS = [
    'AUTH_SECRET',
    'BASE_URL',
    'TRUSTED_ORIGINS',
    'UPLOAD_CHUNK_BYTES',
    'GITHUB_CLIENT_ID',
    'GITHUB_CLIENT_SECRET',
    'GITLAB_CLIENT_ID',
    'GITLAB_CLIENT_SECRET',
    'GITLAB_ISSUER',
] as const;

const saved : Record<string, string | undefined> = {};

// Start each case from a clean, minimally valid environment: an AUTH_SECRET that passes validation, every provider
// key absent, and BASE_URL cleared so its default applies (the Vitest/Vite process leaks BASE_URL='/', which the
// URL schema would reject). A case sets only the provider halves it is exercising.
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
    // An instance with no AUTH_SECRET in its environment resolves one from its database at boot, so the loader has
    // nothing to complain about -- the key is simply unset here.
    it('loads with no AUTH_SECRET in the environment', () =>
    {
        Reflect.deleteProperty(process.env, 'AUTH_SECRET');

        expect(loadConfig().AUTH_SECRET).toBeUndefined();
    });

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

describe('loadConfig BASE_URL', () =>
{
    // The instance's own scheme and host: better-auth builds every URL it hands out from them, so anything that is
    // not an http(s) URL fails the boot instead of producing nonsense links.
    it('refuses a BASE_URL that is not an http(s) URL', () =>
    {
        process.env['BASE_URL'] = 'ftp://files.example.com';

        expect(() => loadConfig()).toThrow(/BASE_URL must be an http\(s\) URL/);
    });
});

//----------------------------------------------------------------------------------------------------------------------

describe('loadConfig TRUSTED_ORIGINS', () =>
{
    // An https canonical URL, so the entries under test can be written the way a real deployment writes them.
    beforeEach(() => { process.env['BASE_URL'] = 'https://files.example.com'; });

    // Nothing set means nothing added: BASE_URL stays the entire trust list, which is the behavior every existing
    // deployment already has.
    it('is an empty list when the variable is unset', () =>
    {
        expect(loadConfig().TRUSTED_ORIGINS).toEqual([]);
    });

    it('reads a comma-separated list in order, ignoring the spacing around entries', () =>
    {
        process.env['TRUSTED_ORIGINS'] = ' https://alt.example.com ,https://files.internal:3950 ';

        expect(loadConfig().TRUSTED_ORIGINS).toEqual([ 'https://alt.example.com', 'https://files.internal:3950' ]);
    });

    // An Origin header is scheme, host and port and nothing else, so an entry written as a full URL has to come
    // down to the same thing. A default port is part of that: a browser on https://files.example.com:443 sends
    // https://files.example.com.
    it('reduces each entry to its origin, dropping paths, trailing slashes and default ports', () =>
    {
        process.env['TRUSTED_ORIGINS'] = 'https://files.example.com/,https://alt.example.com/app?x=1,'
            + 'https://port.example.com:443';

        expect(loadConfig().TRUSTED_ORIGINS)
            .toEqual([ 'https://files.example.com', 'https://alt.example.com', 'https://port.example.com' ]);
    });

    it('ignores empty entries left by a trailing or doubled comma', () =>
    {
        process.env['TRUSTED_ORIGINS'] = 'https://files.example.com,,';

        expect(loadConfig().TRUSTED_ORIGINS).toEqual([ 'https://files.example.com' ]);
    });

    // A hostname with no scheme is the likely typo, and it has no origin to match against. Refusing at boot beats
    // loading it into a list where it silently matches nothing.
    it('refuses an entry that is not a URL, naming the entry', () =>
    {
        process.env['TRUSTED_ORIGINS'] = 'https://files.example.com,files.internal';

        expect(() => loadConfig()).toThrow(/files\.internal/);
    });

    it('refuses a scheme that has no origin', () =>
    {
        process.env['TRUSTED_ORIGINS'] = 'fileshed://open';

        expect(() => loadConfig()).toThrow(/fileshed:\/\/open/);
    });

    // One protocol covers every alternate, taken from BASE_URL, and it is what decides Secure cookies too. An entry
    // on the other scheme would be built and cookied wrong, so it is refused by name instead.
    it('refuses an entry whose scheme differs from BASE_URL, naming it', () =>
    {
        process.env['TRUSTED_ORIGINS'] = 'https://alt.example.com,http://files.internal:3950';

        expect(() => loadConfig()).toThrow(/http:\/\/files\.internal:3950/);
    });

    // The rule is "same as BASE_URL", not "https": a plain-http instance on a LAN takes plain-http alternates.
    it('takes an all-http list under an http BASE_URL', () =>
    {
        process.env['BASE_URL'] = 'http://files.internal:3950';
        process.env['TRUSTED_ORIGINS'] = 'http://192.168.1.20:3950';

        expect(loadConfig().TRUSTED_ORIGINS).toEqual([ 'http://192.168.1.20:3950' ]);
    });
});

//----------------------------------------------------------------------------------------------------------------------

describe('loadConfig UPLOAD_CHUNK_BYTES', () =>
{
    // Nothing set leaves every deployment on the compiled default, which is also what the client is handed with its
    // ticket -- an instance that never heard of this variable behaves exactly as it did before it existed.
    it('falls back to the compiled default when the variable is unset', () =>
    {
        expect(loadConfig().UPLOAD_CHUNK_BYTES).toBe(DEFAULT_UPLOAD_CHUNK_BYTES);
    });

    it('takes an override from the environment', () =>
    {
        process.env['UPLOAD_CHUNK_BYTES'] = '16777216';

        expect(loadConfig().UPLOAD_CHUNK_BYTES).toBe(16_777_216);
    });

    // Below 1 MiB there is no proxy left to appease -- the tightest common cap is already cleared at the floor -- so a
    // smaller value only multiplies round trips. It is a misconfiguration, and the boot says so with the value it read.
    it('refuses a size under the 1 MiB floor, naming the value it was given', () =>
    {
        process.env['UPLOAD_CHUNK_BYTES'] = String(MIN_UPLOAD_CHUNK_BYTES - 1);

        expect(() => loadConfig()).toThrow(/UPLOAD_CHUNK_BYTES is 1048575/);
    });

    it('accepts exactly the floor', () =>
    {
        process.env['UPLOAD_CHUNK_BYTES'] = String(MIN_UPLOAD_CHUNK_BYTES);

        expect(loadConfig().UPLOAD_CHUNK_BYTES).toBe(MIN_UPLOAD_CHUNK_BYTES);
    });

    // No ceiling: only the operator knows what their own stack will accept in one request, so a large value is their
    // call to make and not ours to second-guess.
    it('imposes no upper bound', () =>
    {
        process.env['UPLOAD_CHUNK_BYTES'] = '1073741824';

        expect(loadConfig().UPLOAD_CHUNK_BYTES).toBe(1_073_741_824);
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
