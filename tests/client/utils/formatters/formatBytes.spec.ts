//----------------------------------------------------------------------------------------------------------------------
// Byte and Quota Formatting
//----------------------------------------------------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';

import { formatBytes } from '@client/utils/formatters/formatBytes.ts';

//----------------------------------------------------------------------------------------------------------------------

describe('formatBytes', () =>
{
    it('renders whole bytes below one kilobyte', () =>
    {
        expect(formatBytes(0)).toBe('0 B');
        expect(formatBytes(512)).toBe('512 B');
        expect(formatBytes(999)).toBe('999 B');
    });

    // The symbols are SI: the kilo prefix is lowercase because uppercase K is kelvin, and every byte suffix is an
    // uppercase B because a lowercase b is bits.
    it('steps up one decimal unit per multiple of 1000, in SI symbols', () =>
    {
        expect(formatBytes(1000)).toBe('1 kB');
        expect(formatBytes(1_000_000)).toBe('1 MB');
        expect(formatBytes(2_000_000_000)).toBe('2 GB');
        expect(formatBytes(1_000_000_000_000)).toBe('1 TB');
        expect(formatBytes(1_000_000_000_000_000)).toBe('1 PB');
    });

    it('keeps a single decimal place for fractional sizes', () =>
    {
        expect(formatBytes(1536)).toBe('1.5 kB');
        expect(formatBytes(1_500_000)).toBe('1.5 MB');
        expect(formatBytes(2560)).toBe('2.6 kB');
    });

    it('trims a trailing .0 so exact sizes read cleanly', () =>
    {
        expect(formatBytes(2048)).toBe('2 kB');
    });

    it('treats negative or non-finite input as zero', () =>
    {
        expect(formatBytes(-5)).toBe('0 B');
        expect(formatBytes(Number.NaN)).toBe('0 B');
    });
});

//----------------------------------------------------------------------------------------------------------------------
