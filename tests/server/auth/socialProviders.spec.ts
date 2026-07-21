//----------------------------------------------------------------------------------------------------------------------
// Auth — social providers from config
//
// OAuth providers are config, not code: createAuth derives its socialProviders entirely from the env-backed config,
// activating a provider only when both halves of its pair are present (the both-or-neither rule itself is enforced by
// the config schema, tested separately). These pin the config -> providers mapping, and that a configured provider
// actually reaches the live auth instance -- without faking an OAuth round-trip.
//----------------------------------------------------------------------------------------------------------------------

import { afterEach, describe, expect, it } from 'vitest';

// Resource Access
import { type DatabaseHandle, createDatabase } from '@server/resource-access/database/database.ts';
import { createAuth, socialProvidersFromConfig } from '@server/resource-access/auth.ts';

// Support
import { testConfig } from './support.ts';

//----------------------------------------------------------------------------------------------------------------------

describe('socialProvidersFromConfig', () =>
{
    it('configures github only when both its client id and secret are present', () =>
    {
        const providers = socialProvidersFromConfig(
            testConfig({ GITHUB_CLIENT_ID: 'gh-id', GITHUB_CLIENT_SECRET: 'gh-secret' })
        );

        expect(providers?.github).toEqual({ clientId: 'gh-id', clientSecret: 'gh-secret' });
        expect(providers?.google).toBeUndefined();
    });

    it('configures google only when both its client id and secret are present', () =>
    {
        const providers = socialProvidersFromConfig(
            testConfig({ GOOGLE_CLIENT_ID: 'g-id', GOOGLE_CLIENT_SECRET: 'g-secret' })
        );

        expect(providers?.google).toEqual({ clientId: 'g-id', clientSecret: 'g-secret' });
        expect(providers?.github).toBeUndefined();
    });

    it('configures both providers when both pairs are present', () =>
    {
        const providers = socialProvidersFromConfig(testConfig({
            GITHUB_CLIENT_ID: 'gh-id',
            GITHUB_CLIENT_SECRET: 'gh-secret',
            GOOGLE_CLIENT_ID: 'g-id',
            GOOGLE_CLIENT_SECRET: 'g-secret',
        }));

        expect(providers?.github).toEqual({ clientId: 'gh-id', clientSecret: 'gh-secret' });
        expect(providers?.google).toEqual({ clientId: 'g-id', clientSecret: 'g-secret' });
    });

    it('yields no providers when neither pair is configured', () =>
    {
        expect(socialProvidersFromConfig(testConfig())).toBeUndefined();
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

    it('carries a configured provider onto the live auth instance', () =>
    {
        const config = testConfig({ GITHUB_CLIENT_ID: 'gh-id', GITHUB_CLIENT_SECRET: 'gh-secret' });
        handle = createDatabase(config);

        const auth = createAuth(handle, config);

        expect(auth.options.socialProviders?.github?.clientId).toBe('gh-id');
    });

    it('leaves the auth instance with no social providers when none are configured', () =>
    {
        const config = testConfig();
        handle = createDatabase(config);

        const auth = createAuth(handle, config);

        expect(auth.options.socialProviders).toBeUndefined();
    });
});

//----------------------------------------------------------------------------------------------------------------------
