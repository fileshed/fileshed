//----------------------------------------------------------------------------------------------------------------------
// Quota Formatting
//----------------------------------------------------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';

import { nearingQuotaCap, quotaHoverLabel, quotaPercent } from '@client/utils/formatters/formatQuota.ts';

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

describe('nearingQuotaCap', () =>
{
    it('warns from 80% of the cap onward', () =>
    {
        expect(nearingQuotaCap({ used: 8000, effective: 10_000 })).toBe(true);
        expect(nearingQuotaCap({ used: 10_000, effective: 10_000 })).toBe(true);
    });

    it('stays quiet just under the threshold', () =>
    {
        expect(nearingQuotaCap({ used: 7999, effective: 10_000 })).toBe(false);
    });

    it('never warns an account nothing caps, however much it holds', () =>
    {
        expect(nearingQuotaCap({ used: 1_000_000_000, effective: null })).toBe(false);
    });

    it('stays quiet before a profile has loaded', () =>
    {
        expect(nearingQuotaCap(null)).toBe(false);
    });
});

//----------------------------------------------------------------------------------------------------------------------

describe('quotaHoverLabel', () =>
{
    it('names the whole-percent share of a real cap', () =>
    {
        expect(quotaHoverLabel({ used: 9000, effective: 10_000 })).toBe('90% of your storage used');
    });

    it('rounds to the nearest whole percent', () =>
    {
        expect(quotaHoverLabel({ used: 4567, effective: 10_000 })).toBe('46% of your storage used');
    });

    it('has nothing to say without a cap to measure against', () =>
    {
        expect(quotaHoverLabel({ used: 4096, effective: null })).toBeUndefined();
        expect(quotaHoverLabel(null)).toBeUndefined();
    });
});

//----------------------------------------------------------------------------------------------------------------------
