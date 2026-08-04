//----------------------------------------------------------------------------------------------------------------------
// Auth — social providers from boot-resolved values
//
// FileShed curates nothing: the provider vocabulary is a verbatim mirror of better-auth's own list, pinned here so
// a library bump that changes the set fails a test instead of silently drifting. A provider activates only when
// every key its contract requires holds a value -- the credential pair for almost all, Cognito's pool coordinates
// and TikTok's client key where their protocols demand more -- and a partial configuration is silently inactive,
// never a boot failure. activeProviderIDs must agree exactly with what activates, because it is what the sign-in
// page's buttons are built from.
//----------------------------------------------------------------------------------------------------------------------

import { afterEach, describe, expect, it } from 'vitest';
import { socialProviderList } from 'better-auth/social-providers';

import { socialProviderIDs } from '@fileshed/core';

// Resource Access
import { type DatabaseHandle, createDatabase } from '@server/resource-access/database/database.ts';
import {
    type ProviderBootValues,
    activeProviderIDs,
    createAuth,
    providerValuesFromConfig,
    socialProvidersFromValues,
} from '@server/resource-access/auth.ts';

// Support
import { TEST_AUTH_SECRET, testConfig } from './support.ts';

//----------------------------------------------------------------------------------------------------------------------

describe('the provider vocabulary', () =>
{
    it('mirrors better-auth\'s own provider list exactly -- curation is a non-decision', () =>
    {
        expect([ ...socialProviderIDs ].sort()).toEqual([ ...socialProviderList ].sort());
    });
});

//----------------------------------------------------------------------------------------------------------------------

describe('socialProvidersFromValues', () =>
{
    it('activates a standard provider from its credential pair alone', () =>
    {
        const providers = socialProvidersFromValues({
            GITHUB_CLIENT_ID: 'gh-id',
            GITHUB_CLIENT_SECRET: 'gh-secret',
        });

        expect(providers?.github).toEqual({ clientId: 'gh-id', clientSecret: 'gh-secret' });
        expect(providers && Object.keys(providers)).toEqual([ 'github' ]);
    });

    it('leaves a partially configured provider silently inactive', () =>
    {
        expect(socialProvidersFromValues({ GITHUB_CLIENT_ID: 'gh-id' })).toBeUndefined();
        expect(socialProvidersFromValues({ DISCORD_CLIENT_SECRET: 'd-secret' })).toBeUndefined();
    });

    it('holds cognito inactive until its pool coordinates join the credential pair', () =>
    {
        const partial : ProviderBootValues = {
            COGNITO_CLIENT_ID: 'c-id',
            COGNITO_CLIENT_SECRET: 'c-secret',
        };
        expect(socialProvidersFromValues(partial)).toBeUndefined();

        const complete = socialProvidersFromValues({
            ...partial,
            COGNITO_DOMAIN: 'auth.example.com',
            COGNITO_REGION: 'us-east-1',
            COGNITO_USER_POOL_ID: 'us-east-1_pool',
        });

        expect(complete?.cognito).toMatchObject({
            clientId: 'c-id',
            domain: 'auth.example.com',
            region: 'us-east-1',
            userPoolId: 'us-east-1_pool',
        });
    });

    it('builds tiktok on its client key, which its protocol uses instead of a client id', () =>
    {
        expect(socialProvidersFromValues({ TIKTOK_CLIENT_ID: 'unused', TIKTOK_CLIENT_SECRET: 's' }))
            .toBeUndefined();

        const providers = socialProvidersFromValues({
            TIKTOK_CLIENT_KEY: 'tt-key',
            TIKTOK_CLIENT_SECRET: 'tt-secret',
        });

        expect(providers?.tiktok).toMatchObject({ clientKey: 'tt-key', clientSecret: 'tt-secret' });
    });

    it('carries the optional extras only when set: gitlab issuer, microsoft tenant, apple bundle id', () =>
    {
        const providers = socialProvidersFromValues({
            GITLAB_CLIENT_ID: 'gl-id',
            GITLAB_CLIENT_SECRET: 'gl-secret',
            GITLAB_ISSUER: 'https://gitlab.example.com',
            MICROSOFT_CLIENT_ID: 'ms-id',
            MICROSOFT_CLIENT_SECRET: 'ms-secret',
            APPLE_CLIENT_ID: 'ap-id',
            APPLE_CLIENT_SECRET: 'ap-secret',
        });

        expect(providers?.gitlab).toMatchObject({ issuer: 'https://gitlab.example.com' });
        expect(providers?.microsoft).not.toHaveProperty('tenantId');
        expect(providers?.apple).not.toHaveProperty('appBundleIdentifier');
    });

    it('yields no providers at all when nothing is configured', () =>
    {
        expect(socialProvidersFromValues({})).toBeUndefined();
    });
});

//----------------------------------------------------------------------------------------------------------------------

describe('activeProviderIDs', () =>
{
    it('lists exactly the providers whose required keys all hold values', () =>
    {
        expect(activeProviderIDs({})).toEqual([]);
        expect(activeProviderIDs({ GITHUB_CLIENT_ID: 'id' })).toEqual([]);
        expect(activeProviderIDs({
            GITHUB_CLIENT_ID: 'id',
            GITHUB_CLIENT_SECRET: 's',
            DISCORD_CLIENT_ID: 'd-id',
            DISCORD_CLIENT_SECRET: 'd-s',
        }).sort()).toEqual([ 'discord', 'github' ]);
    });
});

//----------------------------------------------------------------------------------------------------------------------

describe('providerValuesFromConfig', () =>
{
    it('carries every provider setting the config holds, absent ones as null', () =>
    {
        const values = providerValuesFromConfig(
            testConfig({ GITHUB_CLIENT_ID: 'gh-id', GITHUB_CLIENT_SECRET: 'gh-secret' })
        );

        expect(values.GITHUB_CLIENT_ID).toBe('gh-id');
        expect(values.GITHUB_CLIENT_SECRET).toBe('gh-secret');
        expect(values.GOOGLE_CLIENT_ID).toBeNull();
        expect(values.COGNITO_DOMAIN).toBeNull();
    });
});

//----------------------------------------------------------------------------------------------------------------------

describe('createAuth social providers', () =>
{
    let handle : DatabaseHandle;

    afterEach(async () =>
    {
        await handle.db.destroy();
    });

    it('prefers boot-resolved values over the config pair', () =>
    {
        const config = testConfig({ GITHUB_CLIENT_ID: 'env-id', GITHUB_CLIENT_SECRET: 'env-secret' });
        handle = createDatabase(config);

        const auth = createAuth(handle, config, TEST_AUTH_SECRET, {
            providerValues: { GITHUB_CLIENT_ID: 'settings-id', GITHUB_CLIENT_SECRET: 'settings-secret' },
        });

        expect(auth.options.socialProviders?.github?.clientId).toBe('settings-id');
    });

    it('falls back to config-derived values when no boot resolution is supplied', () =>
    {
        const config = testConfig({ GITHUB_CLIENT_ID: 'gh-id', GITHUB_CLIENT_SECRET: 'gh-secret' });
        handle = createDatabase(config);

        const auth = createAuth(handle, config, TEST_AUTH_SECRET);

        expect(auth.options.socialProviders?.github?.clientId).toBe('gh-id');
    });

    it('leaves the auth instance with no social providers when none are configured', () =>
    {
        const config = testConfig();
        handle = createDatabase(config);

        const auth = createAuth(handle, config, TEST_AUTH_SECRET);

        expect(auth.options.socialProviders).toBeUndefined();
    });
});

//----------------------------------------------------------------------------------------------------------------------
