//----------------------------------------------------------------------------------------------------------------------
// Share Request Codec -- status/resolvedAt union
//----------------------------------------------------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';

import { shareRequestCodec } from '@fileshed/core';

//----------------------------------------------------------------------------------------------------------------------

const baseFields = {
    id: 'req_1',
    nodeID: 'node_1',
    requesterID: 'user_2',
    requestedRole: 'viewer',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
};

//----------------------------------------------------------------------------------------------------------------------

describe('shareRequestCodec', () =>
{
    it('parses a pending request with a null resolvedAt', () =>
    {
        const pending = { ...baseFields, status: 'pending', resolvedAt: null };

        expect(shareRequestCodec.safeParse(pending).success).toBe(true);
    });

    it('parses a granted request with a resolvedAt timestamp', () =>
    {
        const granted = { ...baseFields, status: 'granted', resolvedAt: new Date('2026-01-02T00:00:00.000Z') };

        expect(shareRequestCodec.safeParse(granted).success).toBe(true);
    });

    it('parses a declined request with a resolvedAt timestamp', () =>
    {
        const declined = { ...baseFields, status: 'declined', resolvedAt: new Date('2026-01-02T00:00:00.000Z') };

        expect(shareRequestCodec.safeParse(declined).success).toBe(true);
    });

    // requirements.md secs 3.1/3.5: resolvedAt is set exactly when the request leaves pending. A pending request that
    // already carries a resolution time is an illegal state the union must reject.
    it('rejects a pending request that carries a resolvedAt', () =>
    {
        const bogus = { ...baseFields, status: 'pending', resolvedAt: new Date('2026-01-02T00:00:00.000Z') };

        expect(shareRequestCodec.safeParse(bogus).success).toBe(false);
    });

    // requirements.md secs 3.1/3.5: the mirror illegal state -- a resolved request without a resolution time.
    it('rejects a granted request with a null resolvedAt', () =>
    {
        const bogus = { ...baseFields, status: 'granted', resolvedAt: null };

        expect(shareRequestCodec.safeParse(bogus).success).toBe(false);
    });

    // requirements.md sec 3.5: a request asks for a grantable role -- viewer or editor, never owner.
    it('rejects a request for the owner role', () =>
    {
        const ownerAsk = { ...baseFields, requestedRole: 'owner', status: 'pending', resolvedAt: null };

        expect(shareRequestCodec.safeParse(ownerAsk).success).toBe(false);
    });
});

//----------------------------------------------------------------------------------------------------------------------
