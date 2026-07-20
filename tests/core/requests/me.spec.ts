//----------------------------------------------------------------------------------------------------------------------
// Me DTO -- the quota shape and the unlimited (null) case
//----------------------------------------------------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';

import { meResponseCodec } from '@fileshed/core';

//----------------------------------------------------------------------------------------------------------------------

describe('meResponseCodec', () =>
{
    const base = {
        id: 'user_1',
        email: 'ada@example.com',
        role: 'user' as const,
        createdAt: '2026-01-01T00:00:00.000Z',
    };

    // quotaLimit is null for an unlimited account -- the wire shape must admit that, not force a numeric sentinel.
    it('accepts a null quota limit for an unlimited account', () =>
    {
        const result = meResponseCodec.safeParse({ ...base, quota: { used: 4096, limit: null } });

        expect(result.success).toBe(true);
    });

    // a 0 limit is a valid block-all quota (the regulation engine admits only zero-byte writes
    // against it), distinct from null. The wire shape must accept it rather than rejecting it as non-positive.
    it('accepts a zero quota limit as a real block-all limit', () =>
    {
        const result = meResponseCodec.safeParse({ ...base, quota: { used: 0, limit: 0 } });

        expect(result.success).toBe(true);
    });

    it('rejects a negative used value', () =>
    {
        const result = meResponseCodec.safeParse({ ...base, quota: { used: -1, limit: null } });

        expect(result.success).toBe(false);
    });

    it('rejects a negative quota limit', () =>
    {
        const result = meResponseCodec.safeParse({ ...base, quota: { used: 0, limit: -1 } });

        expect(result.success).toBe(false);
    });
});

//----------------------------------------------------------------------------------------------------------------------
