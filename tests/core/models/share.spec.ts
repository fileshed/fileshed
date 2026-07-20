//----------------------------------------------------------------------------------------------------------------------
// Share Codec
//----------------------------------------------------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';

import { shareCodec } from '@fileshed/core';

//----------------------------------------------------------------------------------------------------------------------

describe('shareCodec', () =>
{
    it('parses a valid editor share', () =>
    {
        const share = {
            id: 'share_1',
            nodeID: 'node_1',
            granteeUserID: 'user_2',
            role: 'editor',
            createdBy: 'user_1',
            createdAt: new Date('2026-01-01T00:00:00.000Z'),
        };

        expect(shareCodec.safeParse(share).success).toBe(true);
    });

    // a share's role is viewer or editor -- a share never grants ownership.
    it('rejects a share granting the owner role', () =>
    {
        const ownerGrant = {
            id: 'share_2',
            nodeID: 'node_1',
            granteeUserID: 'user_2',
            role: 'owner',
            createdBy: 'user_1',
            createdAt: new Date('2026-01-01T00:00:00.000Z'),
        };

        expect(shareCodec.safeParse(ownerGrant).success).toBe(false);
    });

    // codecs reject wrong-shape input rather than stripping it.
    it('rejects a share carrying an unknown field', () =>
    {
        const foreign = {
            id: 'share_3',
            nodeID: 'node_1',
            granteeUserID: 'user_2',
            role: 'viewer',
            createdBy: 'user_1',
            createdAt: new Date('2026-01-01T00:00:00.000Z'),
            expiresAt: new Date('2026-02-01T00:00:00.000Z'),
        };

        expect(shareCodec.safeParse(foreign).success).toBe(false);
    });
});

//----------------------------------------------------------------------------------------------------------------------
