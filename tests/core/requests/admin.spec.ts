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
            quotaEffective: null,
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
        const wire = toAdminUserResponse({
            profile: { ...profile, name: undefined },
            quotaEffective: null,
            usedBytes: 0,
        });

        expect('name' in wire).toBe(false);
        expect(adminUserResponseCodec.safeParse(wire).success).toBe(true);
    });

    // The row carries the raw column and the resolved cap side by side: an inheriting account (null limit) under a
    // capped instance still reports the cap it is held to, which is what lets the client mark it as the default
    // without knowing the rule.
    it('carries the resolved cap alongside the raw per-user limit', () =>
    {
        const wire = toAdminUserResponse({
            profile: { ...profile, quotaLimit: null },
            quotaEffective: 10_000,
            usedBytes: 0,
        });

        expect(wire.quotaLimit).toBe(null);
        expect(wire.quotaEffective).toBe(10_000);
        expect(adminUserResponseCodec.safeParse(wire).success).toBe(true);
    });
});

describe('adminUserResponseCodec', () =>
{
    // 0 is the raw column's spelling of "no cap"; the resolved field spells it null. A 0 on the wire would render as
    // a zero-byte cap, so the contract refuses it outright rather than leaving the client to interpret.
    it('refuses a zero effective quota, the resolved field\'s way of saying unlimited being null', () =>
    {
        const wire = toAdminUserResponse({ profile, quotaEffective: null, usedBytes: 0 });

        expect(adminUserResponseCodec.safeParse({ ...wire, quotaEffective: 0 }).success).toBe(false);
    });
});

describe('adminUserPageResponseCodec', () =>
{
    it('accepts a serialized page and rejects a Date-typed createdAt', () =>
    {
        const page = toAdminUserPageResponse({
            users: [ { profile, quotaEffective: null, usedBytes: 0 } ],
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
