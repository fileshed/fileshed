//----------------------------------------------------------------------------------------------------------------------
// Admin User DTO -- the wire form of a UserProfile and its serializer
//----------------------------------------------------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';

import {
    type UserProfile,
    adminUserPageResponseCodec,
    adminUserResponseCodec,
    toAdminUserPageResponse,
    toAdminUserResponse,
} from '@fileshed/core';

//----------------------------------------------------------------------------------------------------------------------

const profile : UserProfile = {
    id: 'user_1',
    email: 'ada@example.com',
    name: 'Ada',
    role: 'admin',
    quotaLimit: null,
    banned: false,
    banReason: null,
    banExpires: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
};

//----------------------------------------------------------------------------------------------------------------------

describe('toAdminUserResponse', () =>
{
    // The serializer is the one domain -> wire crossing: dates leave as ISO strings and the result must satisfy the
    // wire codec, or the server would emit responses its own contract rejects.
    it('serializes an entry into a codec-valid wire row with ISO dates', () =>
    {
        const banExpires = new Date('2026-08-01T00:00:00.000Z');
        const wire = toAdminUserResponse({
            profile: { ...profile, banned: true, banReason: 'Spamming', banExpires },
            usedBytes: 1500,
        });

        expect(wire.createdAt).toBe('2026-01-01T00:00:00.000Z');
        expect(wire.banExpires).toBe('2026-08-01T00:00:00.000Z');
        expect(wire.usedBytes).toBe(1500);
        expect(adminUserResponseCodec.safeParse(wire).success).toBe(true);
    });

    // name is optional on the profile; an absent name must be absent on the wire, not serialized as undefined.
    it('omits the name key entirely for a nameless profile', () =>
    {
        const wire = toAdminUserResponse({ profile: { ...profile, name: undefined }, usedBytes: 0 });

        expect('name' in wire).toBe(false);
        expect(adminUserResponseCodec.safeParse(wire).success).toBe(true);
    });
});

describe('adminUserPageResponseCodec', () =>
{
    it('accepts a serialized page and rejects a Date-typed createdAt', () =>
    {
        const page = toAdminUserPageResponse({
            users: [ { profile, usedBytes: 0 } ],
            total: 1,
            limit: 50,
            offset: 0,
        });

        expect(adminUserPageResponseCodec.safeParse(page).success).toBe(true);
        expect(adminUserPageResponseCodec.safeParse({
            ...page,
            users: [ { ...page.users[0], createdAt: new Date() } ],
        }).success).toBe(false);
    });
});

//----------------------------------------------------------------------------------------------------------------------
