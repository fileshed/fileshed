//----------------------------------------------------------------------------------------------------------------------
// Public Link Codec
//----------------------------------------------------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';

import { publicLinkCodec } from '@fileshed/core';

//----------------------------------------------------------------------------------------------------------------------

describe('publicLinkCodec', () =>
{
    it('parses a live link', () =>
    {
        const link = {
            id: 'link_1',
            nodeID: 'node_1',
            token: 'a'.repeat(43),
            createdAt: new Date('2026-01-01T00:00:00.000Z'),
            revokedAt: null,
        };

        expect(publicLinkCodec.safeParse(link).success).toBe(true);
    });

    it('parses a revoked link', () =>
    {
        const link = {
            id: 'link_2',
            nodeID: 'node_1',
            token: 'b'.repeat(43),
            createdAt: new Date('2026-01-01T00:00:00.000Z'),
            revokedAt: new Date('2026-02-01T00:00:00.000Z'),
        };

        expect(publicLinkCodec.safeParse(link).success).toBe(true);
    });

    // The token grants the bytes and nothing more. How a recipient's browser presents them is decided per request, so
    // there is no kind a link can be minted as -- and no field here to carry one.
    it('refuses a link that tries to carry a presentation kind', () =>
    {
        const link = {
            id: 'link_3',
            nodeID: 'node_1',
            token: 'c'.repeat(43),
            disposition: 'attachment',
            createdAt: new Date('2026-01-01T00:00:00.000Z'),
            revokedAt: null,
        };

        expect(publicLinkCodec.safeParse(link).success).toBe(false);
    });
});

//----------------------------------------------------------------------------------------------------------------------
