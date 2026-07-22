//----------------------------------------------------------------------------------------------------------------------
// Drive Filters — preset windows, chip summaries, and owner-chip visibility
//----------------------------------------------------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';

import type { UserSummary } from '@fileshed/core';

// Under test
import {
    modifiedFilterSummary,
    modifiedRange,
    ownerChipVisible,
    ownerFilterSummary,
} from '@client/utils/filterPresets.ts';

//----------------------------------------------------------------------------------------------------------------------

function summary(init : Partial<UserSummary>) : UserSummary
{
    return { id: 'u1', name: 'Ada Lovelace', email: 'ada@example.com', image: null, ...init };
}

//----------------------------------------------------------------------------------------------------------------------

describe('modifiedRange', () =>
{
    // A fixed instant so the calendar-boundary presets resolve deterministically. 13:00 UTC keeps it mid-day in most
    // zones, so "start of today" is unambiguously the same calendar day.
    const now = new Date('2026-07-15T13:00:00.000Z');

    it('resolves "today" to the start of the local day with no upper bound', () =>
    {
        const window = modifiedRange({ kind: 'preset', preset: 'today' }, now);

        expect(window.after).toBe(new Date(2026, 6, 15).toISOString());
        expect(window.before).toBeUndefined();
    });

    // Relative presets count back an exact number of days from the instant, independent of calendar boundaries.
    it('resolves the last-7 and last-30 presets to exact day offsets', () =>
    {
        expect(modifiedRange({ kind: 'preset', preset: 'last7' }, now).after).toBe('2026-07-08T13:00:00.000Z');
        expect(modifiedRange({ kind: 'preset', preset: 'last30' }, now).after).toBe('2026-06-15T13:00:00.000Z');
    });

    it('resolves "this year" to the start of the current calendar year', () =>
    {
        const window = modifiedRange({ kind: 'preset', preset: 'thisYear' }, now);

        expect(window.after).toBe(new Date(2026, 0, 1).toISOString());
        expect(window.before).toBeUndefined();
    });

    // Last year is the only preset that is a closed window: the whole previous calendar year, up to (not including)
    // this year's start.
    it('resolves "last year" to the previous calendar year as a closed window', () =>
    {
        const window = modifiedRange({ kind: 'preset', preset: 'lastYear' }, now);

        expect(window.after).toBe(new Date(2025, 0, 1).toISOString());
        expect(window.before).toBe(new Date(2026, 0, 1).toISOString());
    });

    it('passes a custom range through as its own bounds', () =>
    {
        const range = { kind: 'range' as const, after: '2026-03-01T00:00:00.000Z', before: '2026-03-10T00:00:00.000Z' };

        expect(modifiedRange(range, now)).toEqual({ after: range.after, before: range.before });
    });
});

describe('ownerChipVisible', () =>
{
    it('hides for a folder with zero or one owner and shows for two or more', () =>
    {
        expect(ownerChipVisible([])).toBe(false);
        expect(ownerChipVisible([ summary({ id: 'a' }) ])).toBe(false);
        expect(ownerChipVisible([ summary({ id: 'a' }), summary({ id: 'b' }) ])).toBe(true);
    });
});

describe('ownerFilterSummary', () =>
{
    it('reports null with no owner selected', () =>
    {
        expect(ownerFilterSummary(null)).toBeNull();
    });

    it('reports the owner\'s first name', () =>
    {
        expect(ownerFilterSummary(summary({ name: 'Ada Lovelace' }))).toBe('Ada');
    });

    it('falls back to the email when the name is blank', () =>
    {
        expect(ownerFilterSummary(summary({ name: '   ', email: 'ghost@example.com' }))).toBe('ghost@example.com');
    });
});

describe('modifiedFilterSummary', () =>
{
    it('reports null when no modified filter is set', () =>
    {
        expect(modifiedFilterSummary(null)).toBeNull();
    });

    it('reports the preset label and a generic label for a custom range', () =>
    {
        expect(modifiedFilterSummary({ kind: 'preset', preset: 'last7' })).toBe('Last 7 days');
        expect(modifiedFilterSummary({ kind: 'range', after: 'a', before: 'b' })).toBe('Custom');
    });
});

//----------------------------------------------------------------------------------------------------------------------
