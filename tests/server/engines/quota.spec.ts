//----------------------------------------------------------------------------------------------------------------------
// Quota Engine — resolving a per-user limit against the instance default
//
// The contract: a per-user limit of null inherits whatever the instance default currently says; 0 means unlimited on
// either side and resolves to null; anything positive is the cap in bytes. A per-user value always wins over the
// default -- that is what makes an explicit 0 a pin, holding an account unlimited under a tightened instance cap.
//----------------------------------------------------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';

// Engines
import { effectiveQuota } from '@server/engines/quota.ts';

//----------------------------------------------------------------------------------------------------------------------

const GIGABYTE = 1024 * 1024 * 1024;

//----------------------------------------------------------------------------------------------------------------------

describe('effectiveQuota', () =>
{
    it('leaves an inheriting account uncapped while the instance default is unlimited', () =>
    {
        expect(effectiveQuota(null, 0)).toBeNull();
    });

    it('caps an inheriting account at the instance default', () =>
    {
        expect(effectiveQuota(null, GIGABYTE)).toBe(GIGABYTE);
    });

    // The whole point of the explicit 0: an account pinned unlimited stays unlimited when the instance tightens.
    it('holds an explicitly unlimited account uncapped despite a positive instance default', () =>
    {
        expect(effectiveQuota(0, GIGABYTE)).toBeNull();
    });

    it('resolves an explicitly unlimited account against an unlimited default to unlimited', () =>
    {
        expect(effectiveQuota(0, 0)).toBeNull();
    });

    it('honours a per-user cap where the instance sets no default', () =>
    {
        expect(effectiveQuota(GIGABYTE, 0)).toBe(GIGABYTE);
    });

    // A per-user cap is an answer, not a bid: it is neither raised to a roomier default nor lowered to a tighter one.
    it('honours a per-user cap over the instance default, in both directions', () =>
    {
        expect(effectiveQuota(GIGABYTE, 10 * GIGABYTE)).toBe(GIGABYTE);
        expect(effectiveQuota(10 * GIGABYTE, GIGABYTE)).toBe(10 * GIGABYTE);
    });
});

//----------------------------------------------------------------------------------------------------------------------
