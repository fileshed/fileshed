//----------------------------------------------------------------------------------------------------------------------
// Relative Date Formatting
//----------------------------------------------------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';

import { formatNodeDate } from '@client/utils/formatters/formatDate.ts';

//----------------------------------------------------------------------------------------------------------------------

// A fixed "now" so the today / this-year / older boundaries are deterministic. Constructed from local components so the
// comparison in the formatter (which reads local getters) lines up with these fixtures regardless of the run's zone.
const NOW = new Date(2026, 6, 21, 9, 5); // 2026-07-21 09:05 local

//----------------------------------------------------------------------------------------------------------------------

describe('formatNodeDate', () =>
{
    it('renders a same-day timestamp as a 24-hour clock time tagged "today"', () =>
    {
        expect(formatNodeDate(new Date(2026, 6, 21, 14, 2), NOW)).toBe('14:02 today');
    });

    it('zero-pads the hour and minute of a same-day time', () =>
    {
        expect(formatNodeDate(new Date(2026, 6, 21, 4, 3), NOW)).toBe('04:03 today');
    });

    it('renders an earlier day in the current year as month and day, without a year', () =>
    {
        expect(formatNodeDate(new Date(2026, 6, 3, 10, 0), NOW)).toBe('Jul 3');
    });

    it('renders a date in an earlier year with the year attached', () =>
    {
        expect(formatNodeDate(new Date(2024, 11, 25, 0, 0), NOW)).toBe('Dec 25, 2024');
    });

    it('accepts an ISO string as well as a Date', () =>
    {
        const iso = new Date(2026, 6, 3, 10, 0).toISOString();

        expect(formatNodeDate(iso, NOW)).toBe('Jul 3');
    });

    it('reads an unparseable input as empty rather than "Invalid Date"', () =>
    {
        expect(formatNodeDate('not-a-real-date', NOW)).toBe('');
    });
});

//----------------------------------------------------------------------------------------------------------------------
