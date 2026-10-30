//----------------------------------------------------------------------------------------------------------------------
// PDF Document Facts
//----------------------------------------------------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';

// Engines
import {
    type RawOutlineEntry,
    adoptOutline,
    describePageSize,
    namePageSize,
    textOrNull,
} from '@client/engines/pdf/documentFacts.ts';

//----------------------------------------------------------------------------------------------------------------------

function rawEntry(title : string, items : RawOutlineEntry[] = []) : RawOutlineEntry
{
    return { title, bold: false, italic: false, dest: null, items };
}

//----------------------------------------------------------------------------------------------------------------------

describe('namePageSize', () =>
{
    it('names a standard paper size', () =>
    {
        expect(namePageSize(612, 792)).toBe('Letter');
        expect(namePageSize(612, 1008)).toBe('Legal');
    });

    it('names the same paper turned on its side as landscape', () =>
    {
        expect(namePageSize(792, 612)).toBe('Letter, landscape');
    });

    it('forgives a generator\'s rounding of up to a point', () =>
    {
        expect(namePageSize(595.3, 841.9)).toBe('A4');
    });

    it('names nothing for a size that is no standard paper', () =>
    {
        expect(namePageSize(600, 800)).toBeNull();
        expect(namePageSize(612, 794)).toBeNull();
    });
});

describe('describePageSize', () =>
{
    it('gives the size in inches and millimetres, then its paper name', () =>
    {
        expect(describePageSize(612, 792)).toBe('8.5 × 11 in (216 × 279 mm) — Letter');
    });

    it('rounds inches to hundredths and millimetres to whole numbers', () =>
    {
        expect(describePageSize(600, 800)).toBe('8.33 × 11.11 in (212 × 282 mm)');
    });
});

describe('textOrNull', () =>
{
    it('trims a value from the info dictionary', () =>
    {
        expect(textOrNull('  Quarterly Report ')).toBe('Quarterly Report');
    });

    it('reads a blank value as no value', () =>
    {
        expect(textOrNull('   ')).toBeNull();
        expect(textOrNull(undefined)).toBeNull();
    });
});

describe('adoptOutline', () =>
{
    it('identifies each entry by its position in the tree', () =>
    {
        const outline = adoptOutline([
            rawEntry('Introduction', [ rawEntry('Scope'), rawEntry('Terms') ]),
            rawEntry('Results'),
        ]);

        expect(outline.map((entry) => entry.id)).toEqual([ '0', '1' ]);
        expect(outline[0]?.items.map((entry) => entry.id)).toEqual([ '0.0', '0.1' ]);
        expect(outline[1]?.items).toEqual([]);
    });

    it('trims the titles', () =>
    {
        const outline = adoptOutline([ rawEntry('  Appendix A  ') ]);

        expect(outline[0]?.title).toBe('Appendix A');
    });
});

//----------------------------------------------------------------------------------------------------------------------
