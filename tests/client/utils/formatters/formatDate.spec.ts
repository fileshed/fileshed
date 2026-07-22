//----------------------------------------------------------------------------------------------------------------------
// Relative Date Formatting
//
// The clock style is an argument, not a preference the formatter reads. 24-hour pads the hour ("14:02"); 12-hour drops
// the leading zero on a 1-12 hour, keeps minutes padded, and appends an uppercase meridiem ("2:02 PM"), with midnight
// reading 12 AM and noon reading 12 PM. The month/day/year branches carry no clock, so the style does not affect them.
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
        expect(formatNodeDate(new Date(2026, 6, 21, 14, 2), '24h', NOW)).toBe('14:02 today');
    });

    it('zero-pads the hour and minute of a same-day 24-hour time', () =>
    {
        expect(formatNodeDate(new Date(2026, 6, 21, 4, 3), '24h', NOW)).toBe('04:03 today');
    });

    it('renders a same-day afternoon time in 12-hour form with an uppercase meridiem', () =>
    {
        expect(formatNodeDate(new Date(2026, 6, 21, 14, 2), '12h', NOW)).toBe('2:02 PM today');
    });

    it('renders a same-day morning time in 12-hour form without a leading zero on the hour', () =>
    {
        expect(formatNodeDate(new Date(2026, 6, 21, 4, 3), '12h', NOW)).toBe('4:03 AM today');
    });

    it('reads midnight as 12 AM in 12-hour form', () =>
    {
        expect(formatNodeDate(new Date(2026, 6, 21, 0, 30), '12h', NOW)).toBe('12:30 AM today');
    });

    it('reads noon as 12 PM in 12-hour form', () =>
    {
        expect(formatNodeDate(new Date(2026, 6, 21, 12, 0), '12h', NOW)).toBe('12:00 PM today');
    });

    it('renders an earlier day in the current year as month and day, without a year', () =>
    {
        expect(formatNodeDate(new Date(2026, 6, 3, 10, 0), '24h', NOW)).toBe('Jul 3');
    });

    it('renders a date in an earlier year with the year attached', () =>
    {
        expect(formatNodeDate(new Date(2024, 11, 25, 0, 0), '24h', NOW)).toBe('Dec 25, 2024');
    });

    it('accepts an ISO string as well as a Date', () =>
    {
        const iso = new Date(2026, 6, 3, 10, 0).toISOString();

        expect(formatNodeDate(iso, '24h', NOW)).toBe('Jul 3');
    });

    it('reads an unparseable input as empty rather than "Invalid Date"', () =>
    {
        expect(formatNodeDate('not-a-real-date', '24h', NOW)).toBe('');
    });
});

//----------------------------------------------------------------------------------------------------------------------
