//----------------------------------------------------------------------------------------------------------------------
// Quota Formatting
//----------------------------------------------------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';

import { quotaPercent } from '@client/utils/formatters/formatQuota.ts';

//----------------------------------------------------------------------------------------------------------------------

describe('quotaPercent', () =>
{
    it('is zero for an unlimited (null) quota', () =>
    {
        expect(quotaPercent(1_000_000, null)).toBe(0);
    });

    it('is the used-over-limit percentage for a real cap', () =>
    {
        expect(quotaPercent(0, 1000)).toBe(0);
        expect(quotaPercent(500, 1000)).toBe(50);
        expect(quotaPercent(1000, 1000)).toBe(100);
    });

    it('clamps an over-quota usage to 100', () =>
    {
        expect(quotaPercent(1500, 1000)).toBe(100);
    });

    it('is zero when the cap is zero rather than dividing by it', () =>
    {
        expect(quotaPercent(10, 0)).toBe(0);
    });
});

//----------------------------------------------------------------------------------------------------------------------
