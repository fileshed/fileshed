//----------------------------------------------------------------------------------------------------------------------
// Natural Name Ordering — the comparator every tier is held to
//----------------------------------------------------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';

import { compareNames } from '@fileshed/core';

//----------------------------------------------------------------------------------------------------------------------

// A comparison read as a direction rather than a number, so a test says which name comes first instead of asserting
// a sign the contract never promised the size of.
function before(left : string, right : string) : boolean
{
    return compareNames(left, right) < 0;
}

function ties(left : string, right : string) : boolean
{
    return compareNames(left, right) === 0;
}

//----------------------------------------------------------------------------------------------------------------------

describe('compareNames', () =>
{
    it('compares a run of digits by its value, not character by character', () =>
    {
        expect(before('track-9', 'track-10')).toBe(true);
        expect(before('9lives', '10lives')).toBe(true);
        expect(before('lives9', 'lives10')).toBe(true);
    });

    it('compares a digit run longer than any fixed-width padding could hold', () =>
    {
        expect(before('dump-999999999999', 'dump-1000000000000')).toBe(true);
        expect(before(`v-${ '9'.repeat(40) }`, `v-${ '1'.padEnd(41, '0') }`)).toBe(true);
    });

    it('treats leading zeros as the same number', () =>
    {
        expect(ties('file1', 'file01')).toBe(true);
        expect(ties('file01', 'file001')).toBe(true);
        expect(ties('item-123', 'item-000123')).toBe(true);
    });

    it('never separates two names by case alone', () =>
    {
        expect(ties('apple', 'Apple')).toBe(true);
        expect(ties('APPLE', 'apple')).toBe(true);
    });

    it('never separates two names by an accent alone', () =>
    {
        expect(ties('cafe', 'café')).toBe(true);
        expect(ties('Café', 'cafe')).toBe(true);
    });

    it('still orders names that differ by more than case', () =>
    {
        expect(before('apple', 'Banana')).toBe(true);
        expect(before('Banana', 'cherry')).toBe(true);
    });

    it('sorts a separator below the digits and letters it stands beside', () =>
    {
        expect(before('photo_2', 'photo2')).toBe(true);
        expect(before('photo-2', 'photo2')).toBe(true);
        expect(before('a(1)', 'a1')).toBe(true);
    });

    it('orders two identical names as equal', () =>
    {
        expect(ties('report.txt', 'report.txt')).toBe(true);
    });
});

//----------------------------------------------------------------------------------------------------------------------
