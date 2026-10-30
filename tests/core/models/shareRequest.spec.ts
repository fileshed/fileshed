//----------------------------------------------------------------------------------------------------------------------
// Share Request Codec -- status/resolved union
//----------------------------------------------------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';

import { shareRequestCodec } from '@fileshed/core';

//----------------------------------------------------------------------------------------------------------------------

const baseFields = {
    id: 'req_1',
    nodeID: 'node_1',
    requesterID: 'user_2',
    requestedRole: 'viewer',
    message: null,
    created: new Date('2026-01-01T00:00:00.000Z'),
};

//----------------------------------------------------------------------------------------------------------------------

describe('shareRequestCodec', () =>
{
    it('parses a pending request with a null resolved timestamp', () =>
    {
        const pending = { ...baseFields, status: 'pending', resolved: null };

        expect(shareRequestCodec.safeParse(pending).success).toBe(true);
    });

    // The requester's optional note rides alongside the request; a non-null message is just as valid as no message.
    it('parses a pending request carrying a requester message', () =>
    {
        const pending = {
            ...baseFields, message: 'Could I get viewer access please?', status: 'pending', resolved: null,
        };

        expect(shareRequestCodec.safeParse(pending).success).toBe(true);
    });

    it('parses a granted request with a resolved timestamp', () =>
    {
        const granted = { ...baseFields, status: 'granted', resolved: new Date('2026-01-02T00:00:00.000Z') };

        expect(shareRequestCodec.safeParse(granted).success).toBe(true);
    });

    it('parses a declined request with a resolved timestamp', () =>
    {
        const declined = { ...baseFields, status: 'declined', resolved: new Date('2026-01-02T00:00:00.000Z') };

        expect(shareRequestCodec.safeParse(declined).success).toBe(true);
    });

    // resolved is set exactly when the request leaves pending. A pending request that already carries a resolution
    // time is an illegal state the union must reject.
    it('rejects a pending request that carries a resolved timestamp', () =>
    {
        const bogus = { ...baseFields, status: 'pending', resolved: new Date('2026-01-02T00:00:00.000Z') };

        expect(shareRequestCodec.safeParse(bogus).success).toBe(false);
    });

    // the mirror illegal state -- a resolved request without a resolution time.
    it('rejects a granted request with a null resolved timestamp', () =>
    {
        const bogus = { ...baseFields, status: 'granted', resolved: null };

        expect(shareRequestCodec.safeParse(bogus).success).toBe(false);
    });

    // a request asks for a grantable role -- viewer or editor, never owner.
    it('rejects a request for the owner role', () =>
    {
        const ownerAsk = { ...baseFields, requestedRole: 'owner', status: 'pending', resolved: null };

        expect(shareRequestCodec.safeParse(ownerAsk).success).toBe(false);
    });
});

//----------------------------------------------------------------------------------------------------------------------
