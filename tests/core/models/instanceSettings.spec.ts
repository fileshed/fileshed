//----------------------------------------------------------------------------------------------------------------------
// Instance Settings Vocabulary — a provider's owned keys
//
// providerOwnedKeys is the removal set: resetting exactly these keys must delete everything a provider stores and
// nothing anyone else does. The dangerous case is prefix-sharing ids -- 'line' and 'linear' -- where a sloppy
// prefix match would delete a neighbor's credentials.
//----------------------------------------------------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';

import { providerOwnedKeys } from '@fileshed/core';

//----------------------------------------------------------------------------------------------------------------------

describe('providerOwnedKeys', () =>
{
    it('returns exactly the credential pair for a pair-only provider', () =>
    {
        expect([ ...providerOwnedKeys('github') ].sort()).toEqual([ 'GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET' ]);
    });

    it('includes the extra keys a provider owns beyond its pair', () =>
    {
        expect([ ...providerOwnedKeys('cognito') ].sort()).toEqual([
            'COGNITO_CLIENT_ID',
            'COGNITO_CLIENT_SECRET',
            'COGNITO_DOMAIN',
            'COGNITO_REGION',
            'COGNITO_USER_POOL_ID',
        ]);

        expect([ ...providerOwnedKeys('gitlab') ].sort())
            .toEqual([ 'GITLAB_CLIENT_ID', 'GITLAB_CLIENT_SECRET', 'GITLAB_ISSUER' ]);
    });

    it('never crosses prefix-sharing provider ids', () =>
    {
        expect([ ...providerOwnedKeys('line') ].sort()).toEqual([ 'LINE_CLIENT_ID', 'LINE_CLIENT_SECRET' ]);

        expect([ ...providerOwnedKeys('linear') ].sort()).toEqual([ 'LINEAR_CLIENT_ID', 'LINEAR_CLIENT_SECRET' ]);
    });
});

//----------------------------------------------------------------------------------------------------------------------
