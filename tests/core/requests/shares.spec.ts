//----------------------------------------------------------------------------------------------------------------------
// Share DTOs -- the shares-list envelope pairs each grant with its grantee's summary
//----------------------------------------------------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';

import {
    type Share,
    type SharedTarget,
    shareListEntryCodec,
    shareListResponseCodec,
    sharedWithMeEntryCodec,
    sharedWithMeQueryCodec,
    toShareListEntry,
    toShareResponse,
    toSharedWithMeEntry,
} from '@fileshed/core';

//----------------------------------------------------------------------------------------------------------------------

describe('shareListEntryCodec', () =>
{
    const share = {
        id: 'share_1',
        nodeID: 'node_1',
        granteeUserID: 'user_2',
        role: 'viewer' as const,
        createdBy: 'user_1',
        createdAt: '2026-01-01T00:00:00.000Z',
    };
    const grantee = { id: 'user_2', name: 'Grace Hopper', email: 'grace@example.com', image: null };

    it('accepts a grant paired with its grantee\'s summary', () =>
    {
        expect(shareListEntryCodec.safeParse({ share, grantee }).success).toBe(true);
    });

    // The whole point of the enrichment: a row without a resolvable grantee summary is not a valid entry, so a
    // regression back to the bare grant list fails the codec rather than shipping a placeholder-ready shape.
    it('rejects an entry with no grantee summary', () =>
    {
        expect(shareListEntryCodec.safeParse({ share }).success).toBe(false);
    });
});

describe('shareListResponseCodec', () =>
{
    it('accepts an empty grants list', () =>
    {
        expect(shareListResponseCodec.safeParse({ shares: [] }).success).toBe(true);
    });

    it('rejects a shares list carrying bare grants without their grantee summary', () =>
    {
        const bareShare = {
            id: 'share_1',
            nodeID: 'node_1',
            granteeUserID: 'user_2',
            role: 'viewer',
            createdBy: 'user_1',
            createdAt: '2026-01-01T00:00:00.000Z',
        };

        expect(shareListResponseCodec.safeParse({ shares: [ bareShare ] }).success).toBe(false);
    });
});

describe('toShareListEntry', () =>
{
    it('pairs the serialized share with the supplied grantee summary and satisfies the wire codec', () =>
    {
        const share : Share = {
            id: 'share_1',
            nodeID: 'node_1',
            granteeUserID: 'user_2',
            role: 'editor',
            createdBy: 'user_1',
            createdAt: new Date('2026-01-01T00:00:00.000Z'),
        };
        const grantee = { id: 'user_2', name: 'Grace Hopper', email: 'grace@example.com', image: null };

        const entry = toShareListEntry(share, grantee);

        expect(entry).toEqual({ share: toShareResponse(share), grantee });
        expect(shareListEntryCodec.safeParse(entry).success).toBe(true);
    });
});

//----------------------------------------------------------------------------------------------------------------------
// SharedWithMeEntry -- the shared-with-me envelope pairs each entry with the target's owner summary
//----------------------------------------------------------------------------------------------------------------------

describe('sharedWithMeEntryCodec', () =>
{
    const share = {
        id: 'share_1',
        nodeID: 'node_1',
        granteeUserID: 'me',
        role: 'viewer' as const,
        createdBy: 'user_1',
        createdAt: '2026-01-01T00:00:00.000Z',
    };
    const target = { id: 'node_1', type: 'folder' as const, name: 'Team', ownerID: 'user_1' };
    const owner = { id: 'user_1', name: 'Ada Lovelace', email: 'ada@example.com', image: null };

    it('accepts an entry paired with the target owner\'s summary', () =>
    {
        expect(sharedWithMeEntryCodec.safeParse({ share, target, owner, placed: false }).success).toBe(true);
    });

    // The whole point of the enrichment: an entry without a resolvable owner summary is not a valid entry, so a
    // regression back to the bare target is caught by the codec rather than shipping a placeholder-ready shape.
    it('rejects an entry with no owner summary', () =>
    {
        expect(sharedWithMeEntryCodec.safeParse({ share, target, placed: false }).success).toBe(false);
    });
});

describe('sharedWithMeQueryCodec', () =>
{
    // Absent types is unfiltered, the same wire convention the children listing uses -- an unfiltered call carries no
    // types param at all.
    it('reads an absent types param as the empty (unfiltered) selection', () =>
    {
        const parsed = sharedWithMeQueryCodec.parse({});

        expect(parsed.types).toEqual([]);
    });

    it('splits a comma-separated types param into the selected families', () =>
    {
        const parsed = sharedWithMeQueryCodec.parse({ types: 'images,pdfs' });

        expect(parsed.types).toEqual([ 'images', 'pdfs' ]);
    });

    it('rejects a token outside the type-family vocabulary', () =>
    {
        expect(sharedWithMeQueryCodec.safeParse({ types: 'images,nonsense' }).success).toBe(false);
    });

    it('accepts ISO instant bounds for the modified window', () =>
    {
        const parsed = sharedWithMeQueryCodec.parse({
            updatedAfter: '2026-02-01T00:00:00.000Z',
            updatedBefore: '2026-03-01T00:00:00.000Z',
        });

        expect(parsed.updatedAfter).toBe('2026-02-01T00:00:00.000Z');
        expect(parsed.updatedBefore).toBe('2026-03-01T00:00:00.000Z');
    });

    it('rejects a non-ISO modified bound', () =>
    {
        expect(sharedWithMeQueryCodec.safeParse({ updatedAfter: 'yesterday' }).success).toBe(false);
    });
});

//----------------------------------------------------------------------------------------------------------------------

describe('toSharedWithMeEntry', () =>
{
    it('pairs the serialized share, the target, and the supplied owner summary, satisfying the wire codec', () =>
    {
        const share : Share = {
            id: 'share_1',
            nodeID: 'node_1',
            granteeUserID: 'me',
            role: 'viewer',
            createdBy: 'user_1',
            createdAt: new Date('2026-01-01T00:00:00.000Z'),
        };
        const target : SharedTarget = { id: 'node_1', type: 'folder', name: 'Team', ownerID: 'user_1' };
        const owner = { id: 'user_1', name: 'Ada Lovelace', email: 'ada@example.com', image: null };

        const entry = toSharedWithMeEntry(share, target, owner, true);

        expect(entry).toEqual({ share: toShareResponse(share), target, owner, placed: true });
        expect(sharedWithMeEntryCodec.safeParse(entry).success).toBe(true);
    });
});

//----------------------------------------------------------------------------------------------------------------------
