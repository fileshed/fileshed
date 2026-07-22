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

    it('steps up through decimal units at each multiple of 1000', () =>
    {
        expect(formatBytes(1000)).toBe('1 KB');
        expect(formatBytes(1_000_000)).toBe('1 MB');
        expect(formatBytes(2_000_000_000)).toBe('2 GB');
    });

    it('keeps a single decimal place for fractional sizes', () =>
    {
        expect(formatBytes(1536)).toBe('1.5 KB');
        expect(formatBytes(1_500_000)).toBe('1.5 MB');
        expect(formatBytes(2560)).toBe('2.6 KB');
    });

    it('trims a trailing .0 so exact sizes read cleanly', () =>
    {
        expect(formatBytes(2048)).toBe('2 KB');
    });

    it('treats negative or non-finite input as zero', () =>
    {
        expect(formatBytes(-5)).toBe('0 B');
        expect(formatBytes(Number.NaN)).toBe('0 B');
    });
});

//----------------------------------------------------------------------------------------------------------------------
