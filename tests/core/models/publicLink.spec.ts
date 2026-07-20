//----------------------------------------------------------------------------------------------------------------------
// Public Link Codec
//----------------------------------------------------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';

import { publicLinkCodec } from '@fileshed/core';

//----------------------------------------------------------------------------------------------------------------------

describe('publicLinkCodec', () =>
{
    it('parses a live inline view link', () =>
    {
        const link = {
            id: 'link_1',
            nodeID: 'node_1',
            token: 'a'.repeat(43),
            mode: 'view',
            disposition: 'inline',
            createdAt: new Date('2026-01-01T00:00:00.000Z'),
            revokedAt: null,
        };

        expect(publicLinkCodec.safeParse(link).success).toBe(true);
    });

    it('parses a revoked attachment download link', () =>
    {
        const link = {
            id: 'link_2',
            nodeID: 'node_1',
            token: 'b'.repeat(43),
            mode: 'download',
            disposition: 'attachment',
            createdAt: new Date('2026-01-01T00:00:00.000Z'),
            revokedAt: new Date('2026-02-01T00:00:00.000Z'),
        };

        expect(publicLinkCodec.safeParse(link).success).toBe(true);
    });

    // disposition is inline or attachment -- hotlink vs forced download.
    it('rejects a disposition outside inline and attachment', () =>
    {
        const link = {
            id: 'link_3',
            nodeID: 'node_1',
            token: 'c'.repeat(43),
            mode: 'view',
            disposition: 'preview',
            createdAt: new Date('2026-01-01T00:00:00.000Z'),
            revokedAt: null,
        };

        expect(publicLinkCodec.safeParse(link).success).toBe(false);
    });
});

//----------------------------------------------------------------------------------------------------------------------
