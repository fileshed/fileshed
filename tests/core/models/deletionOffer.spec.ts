//----------------------------------------------------------------------------------------------------------------------
// Deletion Offer Codec
//----------------------------------------------------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';

import { deletionOfferCodec } from '@fileshed/core';

//----------------------------------------------------------------------------------------------------------------------

describe('deletionOfferCodec', () =>
{
    it('parses a valid deletion offer', () =>
    {
        const offer = {
            id: 'offer_1',
            sha256: 'a'.repeat(64),
            offereeID: 'user_2',
            name: 'report.pdf',
            mimeType: 'application/pdf',
            size: 2048,
            createdBy: 'user_1',
            createdAt: new Date('2026-01-01T00:00:00.000Z'),
            expiresAt: new Date('2026-01-08T00:00:00.000Z'),
        };

        expect(deletionOfferCodec.safeParse(offer).success).toBe(true);
    });

    // expiresAt is the blob GC grace deadline that bounds the offer -- an offer without it has
    // no window to accept within, so the codec must require it.
    it('rejects a deletion offer missing its expiresAt', () =>
    {
        const offer = {
            id: 'offer_2',
            sha256: 'a'.repeat(64),
            offereeID: 'user_2',
            name: 'report.pdf',
            mimeType: 'application/pdf',
            size: 2048,
            createdBy: 'user_1',
            createdAt: new Date('2026-01-01T00:00:00.000Z'),
        };

        expect(deletionOfferCodec.safeParse(offer).success).toBe(false);
    });
});

//----------------------------------------------------------------------------------------------------------------------
