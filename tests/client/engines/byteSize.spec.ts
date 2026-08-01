//----------------------------------------------------------------------------------------------------------------------
// Byte Size Parsing — human-entered sizes for the byte-cap inputs
//
// The contract: decimal units (1 kB = 1000 B) in any case with or without a space, plain digits as raw bytes, a
// fractional magnitude allowed only when the unit scales it back to whole bytes, and null -- never a guess -- for
// everything else.
//----------------------------------------------------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';

import { describeByteSize, parseByteSize } from '@client/engines/byteSize.ts';

//----------------------------------------------------------------------------------------------------------------------

describe('parseByteSize', () =>
{
    it('parses decimal units in any case, with or without a space', () =>
    {
        expect(parseByteSize('20gb')).toBe(20_000_000_000);
        expect(parseByteSize('20GB')).toBe(20_000_000_000);
        expect(parseByteSize('20 GB')).toBe(20_000_000_000);
        expect(parseByteSize('200kb')).toBe(200_000);
        expect(parseByteSize('20mb')).toBe(20_000_000);
        expect(parseByteSize('2tb')).toBe(2_000_000_000_000);
        expect(parseByteSize('512b')).toBe(512);
    });

    // The byte inputs prefill from formatBytes, so every symbol it emits has to survive the trip back through here;
    // a prefill that failed to parse would strand its own field.
    it('parses every unit symbol formatBytes emits', () =>
    {
        expect(parseByteSize('999 B')).toBe(999);
        expect(parseByteSize('20 kB')).toBe(20_000);
        expect(parseByteSize('2.1 MB')).toBe(2_100_000);
        expect(parseByteSize('4 GB')).toBe(4_000_000_000);
        expect(parseByteSize('1.5 TB')).toBe(1_500_000_000_000);
        expect(parseByteSize('9 PB')).toBe(9_000_000_000_000_000);
    });

    it('reads plain digits as raw bytes', () =>
    {
        expect(parseByteSize('2048')).toBe(2048);
        expect(parseByteSize('0')).toBe(0);
        expect(parseByteSize('  2048  ')).toBe(2048);
    });

    it('allows a fractional magnitude only when the unit scales it to whole bytes', () =>
    {
        expect(parseByteSize('1.5gb')).toBe(1_500_000_000);
        expect(parseByteSize('0.5kb')).toBe(500);
        expect(parseByteSize('2048.5')).toBeNull();
        expect(parseByteSize('1.5b')).toBeNull();
    });

    it('answers null for anything that is not a size', () =>
    {
        expect(parseByteSize('')).toBeNull();
        expect(parseByteSize('abc')).toBeNull();
        expect(parseByteSize('-5')).toBeNull();
        expect(parseByteSize('20gbps')).toBeNull();
        expect(parseByteSize('gb20')).toBeNull();
        expect(parseByteSize('20 giga')).toBeNull();
    });

    it('refuses sizes beyond the safe-integer range instead of rounding them', () =>
    {
        expect(parseByteSize('10pb')).toBeNull();
        expect(parseByteSize('9pb')).toBe(9_000_000_000_000_000);
    });
});

describe('describeByteSize', () =>
{
    it('reads the count back in whole bytes with separators', () =>
    {
        expect(describeByteSize(20_000_000_000)).toBe(`${ (20_000_000_000).toLocaleString() } bytes`);
    });
});

//----------------------------------------------------------------------------------------------------------------------
