//----------------------------------------------------------------------------------------------------------------------
// User Profile Codec
//----------------------------------------------------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';

import { userProfileCodec } from '@fileshed/core';

//----------------------------------------------------------------------------------------------------------------------

describe('userProfileCodec', () =>
{
    // quotaLimit null means unlimited, and name is optional.
    it('parses a profile with a null quota and no name', () =>
    {
        const profile = {
            id: 'user_1',
            email: 'nobody@example.com',
            role: 'user',
            quotaLimit: null,
            createdAt: new Date('2026-01-01T00:00:00.000Z'),
        };

        expect(userProfileCodec.safeParse(profile).success).toBe(true);
    });

    it('parses an admin profile with a byte quota', () =>
    {
        const profile = {
            id: 'user_2',
            email: 'admin@example.com',
            name: 'Ada',
            role: 'admin',
            quotaLimit: 10_737_418_240,
            createdAt: new Date('2026-01-01T00:00:00.000Z'),
        };

        expect(userProfileCodec.safeParse(profile).success).toBe(true);
    });

    // the account role is admin or user.
    it('rejects a profile with an unknown role', () =>
    {
        const profile = {
            id: 'user_3',
            email: 'someone@example.com',
            role: 'superuser',
            quotaLimit: null,
            createdAt: new Date('2026-01-01T00:00:00.000Z'),
        };

        expect(userProfileCodec.safeParse(profile).success).toBe(false);
    });
});

//----------------------------------------------------------------------------------------------------------------------
