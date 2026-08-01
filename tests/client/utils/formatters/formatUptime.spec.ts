//----------------------------------------------------------------------------------------------------------------------
// Uptime Formatting
//----------------------------------------------------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';

import { formatUptime } from '@client/utils/formatters/formatUptime.ts';

//----------------------------------------------------------------------------------------------------------------------

describe('formatUptime', () =>
{
    it('renders seconds for a process that just started', () =>
    {
        expect(formatUptime(0)).toBe('0s');
        expect(formatUptime(45)).toBe('45s');
    });

    it('drops to whole minutes once past a minute', () =>
    {
        expect(formatUptime(60)).toBe('1m');
        expect(formatUptime(3599)).toBe('59m');
    });

    it('pairs hours with minutes, and omits the minutes when there are none', () =>
    {
        expect(formatUptime(3600)).toBe('1h');
        expect(formatUptime(3600 + (12 * 60))).toBe('1h 12m');
    });

    it('pairs days with hours once past a day, never mentioning minutes', () =>
    {
        expect(formatUptime(86_400)).toBe('1d');
        expect(formatUptime((5 * 86_400) + (3 * 3600) + (59 * 60))).toBe('5d 3h');
    });

    it('treats negative or non-finite input as a fresh start', () =>
    {
        expect(formatUptime(-30)).toBe('0s');
        expect(formatUptime(Number.NaN)).toBe('0s');
    });
});

//----------------------------------------------------------------------------------------------------------------------
